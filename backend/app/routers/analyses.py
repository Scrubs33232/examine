from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models import Analysis
from app.schemas import AnalysisResponse, AnalyzeTextRequest, AnalyzeUrlRequest, LiveOddsResponse
from app.services import ai_engine, market_data, ocr
from app.services.betting_math import compute_bet_metrics
from app.services.platform import detect_platform

router = APIRouter()


async def _run_analysis_pipeline(
    db: AsyncSession,
    *,
    source_type: str,
    source_url: str | None,
    image_path: str | None,
    platform: str,
    market_id: str | None,
    question: str,
    market_yes_probability: float,
    market_no_probability: float,
    volume: float | None,
    liquidity: float | None = None,
    close_date: str | None,
    data_source: str = "api",
) -> Analysis:
    try:
        ai_result = await ai_engine.analyze_market(
            question=question,
            platform=platform,
            market_yes_probability=market_yes_probability,
            volume=volume,
            close_date=close_date,
            data_source=data_source,
        )
    except ai_engine.AiEngineUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    fair_probability = float(ai_result["fair_probability"])
    confidence = float(ai_result["confidence"])

    metrics = compute_bet_metrics(fair_probability, market_yes_probability, confidence)

    analysis = Analysis(
        source_type=source_type,
        source_url=source_url,
        image_path=image_path,
        platform=platform,
        market_id=market_id,
        question=question,
        market_odds={
            "yes": market_yes_probability,
            "no": market_no_probability,
            "volume": volume,
            "liquidity": liquidity,
            "close_date": close_date,
            "source": data_source,
        },
        ai_probability=fair_probability,
        confidence=confidence,
        edge_pct=metrics.edge_pct,
        expected_value=metrics.expected_value,
        kelly_fraction=metrics.kelly_fraction,
        recommendation=metrics.recommendation,
        reasoning=ai_result["reasoning"],
        key_factors=ai_result["key_factors"],
        sentiment=ai_result["sentiment"],
        historical_comparisons=ai_result["historical_comparisons"],
    )

    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)
    return analysis


@router.post("/analyze/url", response_model=AnalysisResponse)
async def analyze_url(payload: AnalyzeUrlRequest, db: AsyncSession = Depends(get_db)):
    parsed = detect_platform(payload.url)
    if parsed.platform == "unknown":
        raise HTTPException(status_code=400, detail="Could not recognize this as a Polymarket, Kalshi, PredictIt, or Manifold URL")

    try:
        market = await market_data.fetch_market(payload.url)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to extract market data: {exc}") from exc

    analysis = await _run_analysis_pipeline(
        db,
        source_type="url",
        source_url=payload.url,
        image_path=None,
        platform=market.platform,
        market_id=market.market_id,
        question=market.question,
        market_yes_probability=market.yes_probability,
        market_no_probability=market.no_probability,
        volume=market.volume,
        liquidity=market.liquidity,
        close_date=market.close_date,
        data_source=market.source,
    )
    return analysis


def _require_usable_ocr(result: ocr.OcrResult) -> None:
    """OCR heuristics degrade to placeholder values ("Unknown market
    question", 50/50 odds) rather than raising when they can't read
    anything useful. Silently running the AI on that placeholder produced
    confusing, low-value analyses with no indication anything went wrong —
    fail loudly and specifically instead, so the user knows to retry with a
    clearer screenshot or the market link."""
    if not result.ocr_available:
        raise HTTPException(
            status_code=422,
            detail="Couldn't read any text from that screenshot. Try a clearer/higher-res image, or paste the market link instead.",
        )
    if result.question_guess == "Unknown market question":
        raise HTTPException(
            status_code=422,
            detail="Found text in the screenshot but couldn't identify a market question. Try cropping tighter around the question, or paste the market link instead.",
        )


@router.post("/analyze/image", response_model=AnalysisResponse)
async def analyze_image(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    result = ocr.extract_from_image(image_bytes)
    _require_usable_ocr(result)
    yes_prob = result.yes_probability_guess if result.yes_probability_guess is not None else 0.5

    analysis = await _run_analysis_pipeline(
        db,
        source_type="image",
        source_url=None,
        image_path=file.filename,
        platform=result.platform_guess,
        market_id=None,
        question=result.question_guess,
        market_yes_probability=yes_prob,
        market_no_probability=1 - yes_prob,
        volume=None,
        close_date=None,
        data_source="ocr" if result.yes_probability_guess is not None else "ocr_no_odds",
    )
    return analysis


@router.post("/analyze/text", response_model=AnalysisResponse)
async def analyze_text(payload: AnalyzeTextRequest, db: AsyncSession = Depends(get_db)):
    """Same as /analyze/image but skips server-side OCR entirely — the
    caller (the frontend, using client-side tesseract.js) already extracted
    the text. Means this endpoint works with no Tesseract installation
    anywhere on the server."""
    if not payload.raw_text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    result = ocr.analyze_text(payload.raw_text)
    _require_usable_ocr(result)
    yes_prob = result.yes_probability_guess if result.yes_probability_guess is not None else 0.5

    analysis = await _run_analysis_pipeline(
        db,
        source_type="image",
        source_url=None,
        image_path=None,
        platform=result.platform_guess,
        market_id=None,
        question=result.question_guess,
        market_yes_probability=yes_prob,
        market_no_probability=1 - yes_prob,
        volume=None,
        close_date=None,
        data_source="ocr" if result.yes_probability_guess is not None else "ocr_no_odds",
    )
    return analysis


@router.get("/analyses/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(analysis_id: str, db: AsyncSession = Depends(get_db)):
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis


@router.get("/analyses", response_model=list[AnalysisResponse])
async def list_analyses(db: AsyncSession = Depends(get_db), limit: int = 20):
    result = await db.execute(select(Analysis).order_by(Analysis.created_at.desc()).limit(limit))
    return result.scalars().all()


@router.get("/analyses/{analysis_id}/live-odds", response_model=LiveOddsResponse)
async def get_live_odds(analysis_id: str, db: AsyncSession = Depends(get_db)):
    """Re-fetches current market odds for an analysis's source market (cheap —
    market_data.fetch_market is cache-backed with a 2min TTL) and recomputes
    edge/EV/Kelly against the AI's original fair-probability read. Lets the
    results page show whether the market has moved toward or away from the
    AI's call since the analysis was run, without re-invoking the AI."""
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if not analysis.source_url:
        raise HTTPException(status_code=422, detail="This analysis has no source URL to re-fetch odds from")

    try:
        market = await market_data.fetch_market(analysis.source_url)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to refresh market data: {exc}") from exc

    metrics = compute_bet_metrics(analysis.ai_probability, market.yes_probability, analysis.confidence)

    return LiveOddsResponse(
        yes=market.yes_probability,
        no=market.no_probability,
        volume=market.volume,
        edge_pct=metrics.edge_pct,
        expected_value=metrics.expected_value,
        kelly_fraction=metrics.kelly_fraction,
        recommendation=metrics.recommendation,
    )
