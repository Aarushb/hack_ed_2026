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

API_PREFIX = "/api"

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

app.mount(f"{API_PREFIX}/static", StaticFiles(directory="static"), name="static")

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(search.router, prefix=f"{API_PREFIX}/search", tags=["search"])
app.include_router(session.router, prefix=f"{API_PREFIX}/session", tags=["session"])
app.include_router(assistant.router, prefix=f"{API_PREFIX}/assistant", tags=["assistant"])
app.include_router(live.router, prefix=f"{API_PREFIX}/live", tags=["live"])


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.2.0"}


@app.get(API_PREFIX)
@app.get(f"{API_PREFIX}/")
def api_root():
    """API-prefixed health check endpoint."""
    return {"status": "ok", "version": "0.2.0"}
