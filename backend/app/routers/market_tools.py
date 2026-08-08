"""Additive, read-only helper endpoints for the /charts screenshot-prediction
feature: raw OCR text extraction (no Claude call) and a Yahoo Finance proxy
for stock price history. Neither endpoint writes to the database or touches
the prediction-market analysis pipeline in analyses.py.
"""

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.services import ocr

router = APIRouter()

_YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ExamineBot/0.1; +https://example.com)"}


class OcrTextResponse(BaseModel):
    raw_text: str
    platform_guess: str
    question_guess: str
    ocr_available: bool


@router.post("/ocr/text", response_model=OcrTextResponse)
async def ocr_text(file: UploadFile = File(...)):
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    result = ocr.extract_from_image(image_bytes)
    return OcrTextResponse(
        raw_text=result.raw_text,
        platform_guess=result.platform_guess,
        question_guess=result.question_guess,
        ocr_available=result.ocr_available,
    )


class StockHistoryResponse(BaseModel):
    ticker: str
    currency: str | None
    closes: list[float]


@router.get("/stocks/history", response_model=StockHistoryResponse)
async def stock_history(ticker: str, range: str = "30d", interval: str = "1h"):
    """Proxies Yahoo Finance's public (undocumented, unauthenticated) chart
    API server-side — browsers can't reliably call it directly due to CORS.
    UNVERIFIED beyond manual testing: Yahoo doesn't publish stable docs for
    this endpoint."""
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")

    async with httpx.AsyncClient(headers=_HEADERS, timeout=10.0) as client:
        try:
            resp = await client.get(
                _YAHOO_CHART_URL.format(ticker=ticker), params={"interval": interval, "range": range}
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Yahoo Finance request failed: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

    data = resp.json()
    result = (data.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

    closes_raw = result.get("indicators", {}).get("quote", [{}])[0].get("close") or []
    closes = [c for c in closes_raw if c is not None]
    if len(closes) < 20:
        raise HTTPException(status_code=422, detail="Not enough price history returned")

    return StockHistoryResponse(ticker=ticker, currency=result.get("meta", {}).get("currency"), closes=closes)
