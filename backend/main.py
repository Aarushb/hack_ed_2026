"""Wayfind API — FastAPI entry point.

Configures CORS, mounts static files, registers all routers, and
sets up structured logging.  Run with:

    cd backend
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import assistant, live, search, session

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Wayfind API",
    version="0.2.0",
    description=(
        "Accessible AI navigation backend — voice-to-voice guidance, "
        "live video, spatial audio, and agentic function calling."
    ),
)

# ---------------------------------------------------------------------------
# CORS (permissive for development — tighten in production)
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Static files (audio cues)
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory="static"), name="static")

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(session.router, prefix="/session", tags=["session"])
app.include_router(assistant.router, prefix="/assistant", tags=["assistant"])
app.include_router(live.router, prefix="/live", tags=["live"])


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.2.0"}
