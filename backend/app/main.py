from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.db import init_db
from app.routers import analyses, calibration, market_tools

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Examine API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyses.router, prefix="/api", tags=["analyses"])
app.include_router(calibration.router, prefix="/api", tags=["calibration"])
app.include_router(market_tools.router, prefix="/api", tags=["market_tools"])


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "claude_configured": settings.has_claude,
        "openai_configured": settings.has_openai,
    }
