import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    # Source
    source_type: Mapped[str] = mapped_column(String(16))  # "url" | "image"
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Market metadata
    platform: Mapped[str] = mapped_column(String(32))  # polymarket | kalshi | predictit | manifold | unknown
    market_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    market_odds: Mapped[dict] = mapped_column(JSON)  # {"yes": 0.62, "no": 0.38, "volume": ..., "close_date": ...}

    # AI analysis
    ai_probability: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)  # 0-1
    edge_pct: Mapped[float] = mapped_column(Float)  # ai_probability - market_probability, in pct points
    expected_value: Mapped[float] = mapped_column(Float)  # per $1 staked on the favored side
    kelly_fraction: Mapped[float] = mapped_column(Float)  # 0-1, fraction of bankroll
    recommendation: Mapped[str] = mapped_column(String(16))  # yes | no | pass
    reasoning: Mapped[str] = mapped_column(Text)  # chain-of-thought summary shown to user
    key_factors: Mapped[list] = mapped_column(JSON)  # [{"label": str, "impact": "positive"|"negative"|"neutral", "weight": float}]
    sentiment: Mapped[dict] = mapped_column(JSON)  # {"score": -1..1, "label": str, "summary": str, "sources": [...]}
    historical_comparisons: Mapped[list] = mapped_column(JSON)  # [{"question": str, "resolved": str, "similarity": float}]

    # Calibration tracking
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | resolved
    actual_outcome: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    brier_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
