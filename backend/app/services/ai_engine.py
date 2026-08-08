"""AI analysis engine: sends the market question + current odds to Claude and
gets back a calibrated fair-probability estimate with structured reasoning.

Uses Anthropic tool-use to force a structured JSON response instead of
parsing free text, since we need reliable fields for the UI (not just prose).

The tool schema uses PARALLEL ARRAYS OF PRIMITIVES (key_factor_labels,
key_factor_impacts, ... ) rather than an array of objects
(key_factors: [{label, impact, weight}, ...]). This looks less natural but is
deliberate: arrays-of-objects inside a forced tool call are a known
reliability weak spot — models occasionally emit them as malformed/partial
JSON or even stray pseudo-XML text instead of a proper array. Flat arrays of
strings/numbers don't have that problem. The nested shape the rest of the
app expects (KeyFactor/Sentiment/HistoricalComparison) is reconstructed here
in Python via zip() after validation.
"""

from datetime import datetime, timezone
from typing import ClassVar, Literal

import anthropic
from anthropic import AsyncAnthropic
from pydantic import BaseModel, Field, ValidationError, model_validator
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_fixed

from app.core.config import get_settings
from app.schemas import HistoricalComparison, KeyFactor, Sentiment

_MODEL = "claude-sonnet-5"

_TOOL_SCHEMA = {
    "name": "submit_market_analysis",
    "description": "Submit a structured probability analysis for a prediction market.",
    "input_schema": {
        "type": "object",
        "properties": {
            "fair_probability": {
                "type": "number",
                "description": "Your calibrated estimate of the true probability the market resolves YES, from 0 to 1.",
            },
            "confidence": {
                "type": "number",
                "description": "Your confidence in this estimate, from 0 (pure guess) to 1 (very confident), based on information quality and how far out the resolution is.",
            },
            "reasoning": {
                "type": "string",
                "description": "3-5 sentences of chain-of-thought reasoning explaining how you arrived at the estimate, written for an educated retail bettor.",
            },
            "key_factor_labels": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 3,
                "maxItems": 6,
                "description": "Short factor names, e.g. 'Polling trend', 'Historical base rate'. Must be the same length as key_factor_impacts and key_factor_weights.",
            },
            "key_factor_impacts": {
                "type": "array",
                "items": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                "minItems": 3,
                "maxItems": 6,
                "description": "For each factor: whether it pushes probability toward YES (positive), NO (negative), or is mixed (neutral). Same length and order as key_factor_labels.",
            },
            "key_factor_weights": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 6,
                "description": "For each factor, 0-1: how much it influenced the estimate. Same length and order as key_factor_labels.",
            },
            "sentiment_score": {
                "type": "number",
                "description": "-1 (very negative news/social sentiment toward YES) to 1 (very positive)",
            },
            "sentiment_label": {"type": "string", "enum": ["bearish", "neutral", "bullish"]},
            "sentiment_summary": {"type": "string", "description": "1-2 sentence summary of the current news/social narrative"},
            "sentiment_sources": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Notable named sources or outlets informing this read (general knowledge, not live browsing)",
            },
            "comparison_questions": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 4,
                "description": "Similar historical prediction market questions. Same length and order as comparison_resolutions and comparison_similarities.",
            },
            "comparison_resolutions": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 4,
                "description": "How each compared market resolved, e.g. 'YES (78% final odds)' or 'NO'. Same length and order as comparison_questions.",
            },
            "comparison_similarities": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 1,
                "maxItems": 4,
                "description": "0-1 similarity of each compared market to the current one. Same length and order as comparison_questions.",
            },
        },
        "required": [
            "fair_probability",
            "confidence",
            "reasoning",
            "key_factor_labels",
            "key_factor_impacts",
            "key_factor_weights",
            "sentiment_score",
            "sentiment_label",
            "sentiment_summary",
            "sentiment_sources",
            "comparison_questions",
            "comparison_resolutions",
            "comparison_similarities",
        ],
    },
}


class _FlatAiToolOutput(BaseModel):
    fair_probability: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    reasoning: str

    key_factor_labels: list[str] = Field(min_length=3, max_length=6)
    key_factor_impacts: list[Literal["positive", "negative", "neutral"]]
    key_factor_weights: list[float]

    sentiment_score: float = Field(ge=-1, le=1)
    sentiment_label: Literal["bearish", "neutral", "bullish"]
    sentiment_summary: str
    sentiment_sources: list[str] = []

    comparison_questions: list[str] = Field(min_length=1, max_length=4)
    comparison_resolutions: list[str]
    comparison_similarities: list[float]

    _ARRAY_FIELDS: ClassVar[tuple[str, ...]] = (
        "key_factor_labels",
        "key_factor_impacts",
        "key_factor_weights",
        "sentiment_sources",
        "comparison_questions",
        "comparison_resolutions",
        "comparison_similarities",
    )

    @model_validator(mode="before")
    @classmethod
    def _repair_comma_joined_arrays(cls, data: dict) -> dict:
        """Claude sometimes emits these arrays as a single comma-joined string
        (still valid JSON — just the wrong type: a str instead of a list).
        Split it back into a list rather than failing and burning a retry."""
        if not isinstance(data, dict):
            return data
        repaired = dict(data)
        for field in cls._ARRAY_FIELDS:
            value = repaired.get(field)
            if isinstance(value, str):
                repaired[field] = [item.strip().strip('"').strip("'") for item in value.split(",") if item.strip()]
        return repaired

    @model_validator(mode="after")
    def _check_parallel_lengths(self) -> "_FlatAiToolOutput":
        if not (len(self.key_factor_labels) == len(self.key_factor_impacts) == len(self.key_factor_weights)):
            raise ValueError("key_factor_labels/impacts/weights must be the same length")
        if not (len(self.comparison_questions) == len(self.comparison_resolutions) == len(self.comparison_similarities)):
            raise ValueError("comparison_questions/resolutions/similarities must be the same length")
        return self

    def to_nested(self) -> dict:
        return {
            "fair_probability": self.fair_probability,
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "key_factors": [
                KeyFactor(label=label, impact=impact, weight=weight).model_dump()
                for label, impact, weight in zip(self.key_factor_labels, self.key_factor_impacts, self.key_factor_weights)
            ],
            "sentiment": Sentiment(
                score=self.sentiment_score,
                label=self.sentiment_label,
                summary=self.sentiment_summary,
                sources=self.sentiment_sources,
            ).model_dump(),
            "historical_comparisons": [
                HistoricalComparison(question=q, resolved=r, similarity=s).model_dump()
                for q, r, s in zip(self.comparison_questions, self.comparison_resolutions, self.comparison_similarities)
            ],
        }


class AiEngineUnavailable(Exception):
    pass


class _IncompleteToolCall(AiEngineUnavailable):
    """Claude occasionally emits a malformed/partial tool call for this schema.
    Retried transparently before surfacing to the caller."""


@retry(
    retry=retry_if_exception_type(_IncompleteToolCall),
    stop=stop_after_attempt(5),
    wait=wait_fixed(0.5),
    reraise=True,
)
async def _call_claude(client: AsyncAnthropic, prompt: str) -> dict:
    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=4096,
            tools=[_TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": "submit_market_analysis"},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIStatusError as exc:
        message = exc.response.json().get("error", {}).get("message", str(exc))
        raise AiEngineUnavailable(f"Claude API error: {message}") from exc
    except anthropic.APIError as exc:
        raise AiEngineUnavailable(f"Claude API error: {exc}") from exc

    if response.stop_reason == "max_tokens":
        raise _IncompleteToolCall("response was cut off before completing the analysis (hit max_tokens)")

    for block in response.content:
        if block.type == "tool_use" and block.name == "submit_market_analysis":
            try:
                validated = _FlatAiToolOutput.model_validate(block.input)
            except ValidationError as exc:
                raise _IncompleteToolCall(f"malformed tool output: {exc}") from exc
            return validated.to_nested()

    raise _IncompleteToolCall("model did not return a tool_use block")


_DATA_SOURCE_NOTES = {
    "api": "Live exchange API — this price is real-time and reliable.",
    "scrape": (
        "Best-effort HTML scrape (the platform's API wasn't usable for this URL). The price "
        "is a rough proxy pulled from the page and may be stale, mismatched to the wrong "
        "outcome, or simply wrong. Weight it accordingly and say so in your reasoning if the "
        "market price looks like it could be unreliable."
    ),
    "fallback": (
        "No price could be extracted at all — this is a neutral 50% placeholder, not a real "
        "market price. Do not treat it as meaningful market information; base your estimate "
        "on the question itself."
    ),
    "ocr": (
        "Extracted via OCR from a user-uploaded screenshot. The question text and price are "
        "both best-effort reads of an image and may contain transcription errors — if the "
        "question reads oddly or the price seems inconsistent with it, note that uncertainty "
        "rather than over-trusting either."
    ),
    "ocr_no_odds": (
        "Extracted via OCR from a user-uploaded screenshot. No price could be read from the "
        "image at all, so the 50% figure below is a neutral placeholder, not a real market "
        "price — base your estimate on the question text alone and flag the missing price."
    ),
}


async def analyze_market(
    question: str,
    platform: str,
    market_yes_probability: float,
    volume: float | None,
    close_date: str | None,
    data_source: str = "api",
) -> dict:
    settings = get_settings()
    if not settings.has_claude:
        raise AiEngineUnavailable("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    today = datetime.now(timezone.utc).date().isoformat()
    data_source_note = _DATA_SOURCE_NOTES.get(data_source, _DATA_SOURCE_NOTES["api"])

    prompt = f"""You are a superforecaster analyzing a prediction market. Use calibrated,
base-rate-aware reasoning rather than anchoring purely on the current market price.

Today's date: {today}
Market question: {question}
Platform: {platform}
Current market-implied YES probability: {market_yes_probability:.1%}
Market data quality: {data_source_note}
Trading volume: {volume if volume is not None else "unknown"}
Close date: {close_date or "unknown"}

Note how much time actually remains between today and the close date — for markets
closing within hours or days, near-term information dominates and there is little
room for long-run base rates to matter; for markets closing far in the future, wide
uncertainty and base rates matter much more.

Estimate the true probability this resolves YES, considering base rates for similar
events and how much genuine uncertainty remains given the time to resolution. Don't
simply restate the market price — form an independent view — but be honest that
prediction markets are often close to efficient, so only diverge meaningfully when
you have a concrete reason. If the market data quality note above indicates the price
is unreliable or missing, say so explicitly in your reasoning and lower your confidence
accordingly rather than anchoring on it.

Keep the reasoning field concise (3-5 sentences). Call the submit_market_analysis
tool with your structured analysis — fill in every field, and keep the parallel
arrays (key_factor_*, comparison_*) the same length as each other."""

    try:
        return await _call_claude(client, prompt)
    except _IncompleteToolCall as exc:
        raise AiEngineUnavailable(f"Claude returned an incomplete analysis after retries ({exc}). Please try again.") from exc
