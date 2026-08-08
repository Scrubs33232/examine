"""Extracts market question + odds from an uploaded screenshot.

Uses local Tesseract OCR (no API key required) by default. If Tesseract
isn't installed on the host, falls back to a low-confidence stub so the
pipeline still produces a result instead of hard-failing — the frontend
surfaces the reduced confidence to the user.
"""

import io
import re
from dataclasses import dataclass

import pytesseract
from PIL import Image

from app.core.config import get_settings

_PLATFORM_KEYWORDS = {
    "polymarket": "polymarket",
    "kalshi": "kalshi",
    "predictit": "predictit",
    "manifold": "manifold",
}


@dataclass
class OcrResult:
    raw_text: str
    platform_guess: str
    question_guess: str
    yes_probability_guess: float | None
    ocr_available: bool


def _configure_tesseract():
    settings = get_settings()
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd


def analyze_text(raw_text: str) -> OcrResult:
    """Pure text heuristics (platform/question/odds guessing) — no image
    processing, no Tesseract dependency. Used both as the second half of
    extract_from_image() below, and directly when the caller already has
    text from elsewhere (e.g. the frontend's client-side tesseract.js OCR,
    which needs no server-side OCR engine installed at all)."""
    lower = raw_text.lower()
    platform_guess = next(
        (name for keyword, name in _PLATFORM_KEYWORDS.items() if keyword in lower),
        "unknown",
    )

    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    # Heuristic: the question is usually the longest line containing a "?"
    # or, failing that, just the longest line.
    question_lines = [l for l in lines if "?" in l] or lines
    question_guess = max(question_lines, key=len) if question_lines else "Unknown market question"

    percent_match = re.search(r"(\d{1,3})\s?%", raw_text)
    yes_probability_guess = None
    if percent_match:
        yes_probability_guess = min(max(int(percent_match.group(1)) / 100, 0.01), 0.99)

    return OcrResult(
        raw_text=raw_text,
        platform_guess=platform_guess,
        question_guess=question_guess,
        yes_probability_guess=yes_probability_guess,
        ocr_available=bool(raw_text.strip()),
    )


def extract_from_image(image_bytes: bytes) -> OcrResult:
    """Server-side OCR via Tesseract. Kept for API compatibility (the
    /api/ocr/text endpoint) and as a fallback, but the frontend no longer
    depends on this — it OCRs client-side instead. Requires the Tesseract
    binary to be installed on this host; degrades to an empty-text result
    (ocr_available=False) if it isn't."""
    _configure_tesseract()

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        raw_text = pytesseract.image_to_string(image)
        engine_ran = True
    except Exception:
        raw_text = ""
        engine_ran = False

    result = analyze_text(raw_text)
    result.ocr_available = engine_ran  # distinct from "found text" — a blank image with a working engine is still available=True
    return result
