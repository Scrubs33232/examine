from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models import Analysis
from app.schemas import AnalysisResponse, CalibrationBucket, CalibrationResponse

router = APIRouter()


class ResolveRequest(BaseModel):
    actual_outcome: bool


@router.post("/analyses/{analysis_id}/resolve", response_model=AnalysisResponse)
async def resolve_analysis(analysis_id: str, payload: ResolveRequest, db: AsyncSession = Depends(get_db)):
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    actual = 1.0 if payload.actual_outcome else 0.0
    analysis.actual_outcome = payload.actual_outcome
    analysis.brier_score = (analysis.ai_probability - actual) ** 2
    analysis.status = "resolved"
    analysis.resolved_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(analysis)
    return analysis


@router.get("/calibration", response_model=CalibrationResponse)
async def get_calibration(db: AsyncSession = Depends(get_db)):
    total_result = await db.execute(select(Analysis))
    all_analyses = total_result.scalars().all()

    resolved = [a for a in all_analyses if a.status == "resolved" and a.actual_outcome is not None]

    overall_brier = round(sum(a.brier_score for a in resolved) / len(resolved), 4) if resolved else None

    bucket_edges = [(i / 10, (i + 1) / 10) for i in range(10)]
    buckets: list[CalibrationBucket] = []
    for lo, hi in bucket_edges:
        in_bucket = [a for a in resolved if lo <= a.ai_probability < hi or (hi == 1.0 and a.ai_probability == 1.0)]
        if not in_bucket:
            continue
        predicted_avg = sum(a.ai_probability for a in in_bucket) / len(in_bucket)
        actual_rate = sum(1.0 if a.actual_outcome else 0.0 for a in in_bucket) / len(in_bucket)
        buckets.append(
            CalibrationBucket(
                range_label=f"{int(lo * 100)}-{int(hi * 100)}%",
                predicted_avg=round(predicted_avg, 3),
                actual_rate=round(actual_rate, 3),
                count=len(in_bucket),
            )
        )

    return CalibrationResponse(
        overall_brier_score=overall_brier,
        total_resolved=len(resolved),
        total_analyses=len(all_analyses),
        buckets=buckets,
    )
