"""Search router — NLP destination search and place resolution.

POST /search/destination:
    Takes a natural-language query + user GPS, returns ranked
    candidates with real coordinates via Gemini + Places API.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from models.schemas import (
    PlaceCandidate,
    SearchRequest,
    SearchResponse,
)
from services import gemini_service, places_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/destination", response_model=SearchResponse)
async def search_destination(request: SearchRequest) -> SearchResponse:
    """Search for a destination using natural language.

    Gemini interprets the query with geographic awareness (the user's
    coordinates tell it roughly where they are), then each result is
    resolved to real GPS coordinates via the Google Places API.

    Args:
        request: Query string and user GPS coordinates.

    Returns:
        Ranked list of :class:`PlaceCandidate` objects.

    Raises:
        HTTPException 503: If both Gemini and Places API fail.
    """
    # 1. Ask Gemini to interpret the query
    try:
        matches = await gemini_service.search_destinations(
            query=request.query,
            user_lat=request.user_lat,
            user_lng=request.user_lng,
        )
    except gemini_service.GeminiServiceUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail="Search service is temporarily unavailable. Please retry in a moment.",
        ) from exc

    if not matches:
        raise HTTPException(
            status_code=503,
            detail="Could not interpret search query. Try a more specific description.",
        )

    # 2. Resolve each match to real coordinates via Places API
    candidates: list[PlaceCandidate] = []

    for match in matches:
        place = await places_service.search_place(match.search_query)
        if place is not None:
            place.confidence = match.confidence
            candidates.append(place)

    if not candidates:
        raise HTTPException(
            status_code=503,
            detail="Found matches but could not resolve coordinates. Try a different query.",
        )

    # Sort by confidence descending
    candidates.sort(key=lambda c: c.confidence, reverse=True)

    logger.info(
        "Search for %r returned %d candidates",
        request.query,
        len(candidates),
    )

    return SearchResponse(candidates=candidates)
