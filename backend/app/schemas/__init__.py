from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MarketOdds(BaseModel):
    yes: float = Field(ge=0, le=1)
    no: float = Field(ge=0, le=1)
    volume: float | None = None
    liquidity: float | None = None
    close_date: str | None = None
    source: str = "api"  # "api" | "scrape" | "fallback" — how these odds were obtained


class KeyFactor(BaseModel):
    label: str
    impact: Literal["positive", "negative", "neutral"]
    weight: float = Field(ge=0, le=1)


class Sentiment(BaseModel):
    score: float = Field(ge=-1, le=1)
    label: Literal["bearish", "neutral", "bullish"]
    summary: str
    sources: list[str] = []


class HistoricalComparison(BaseModel):
    question: str
    resolved: str
    similarity: float = Field(ge=0, le=1)


class AnalyzeUrlRequest(BaseModel):
    url: str


class AnalyzeTextRequest(BaseModel):
    raw_text: str


class AnalysisResponse(BaseModel):
    id: str
    source_type: str
    source_url: str | None
    platform: str
    market_id: str | None
    question: str
    market_odds: MarketOdds
    ai_probability: float
    confidence: float
    edge_pct: float
    expected_value: float
    kelly_fraction: float
    recommendation: str
    reasoning: str
    key_factors: list[KeyFactor]
    sentiment: Sentiment
    historical_comparisons: list[HistoricalComparison]
    status: str
    actual_outcome: bool | None
    brier_score: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CalibrationBucket(BaseModel):
    range_label: str
    predicted_avg: float
    actual_rate: float
    count: int


class CalibrationResponse(BaseModel):
    overall_brier_score: float | None
    total_resolved: int
    total_analyses: int
    buckets: list[CalibrationBucket]


class LiveOddsResponse(BaseModel):
    yes: float
    no: float
    volume: float | None
    edge_pct: float
    expected_value: float
    kelly_fraction: float
    recommendation: str
