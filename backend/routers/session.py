"""Session router — session lifecycle and navigation updates.

Endpoints:
    POST /session/start    — create a new navigation session
    POST /session/describe — generate accessible route overview
    POST /session/resume   — restore a session from localStorage
    POST /session/update   — process a GPS location update
    POST /session/next     — advance to the next waypoint
    GET  /session/{id}     — get current session state
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from models.schemas import (
    LocationUpdateRequest,
    SessionDescribeRequest,
    SessionDescribeResponse,
    SessionNextRequest,
    SessionNextResponse,
    SessionResumeRequest,
    SessionResumeResponse,
    SessionStartRequest,
    SessionStartResponse,
    UpdateResponse,
)
from services import directions_service, gemini_service, session_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Session start
# ---------------------------------------------------------------------------

@router.post("/start", response_model=SessionStartResponse)
async def start_session(request: SessionStartRequest) -> SessionStartResponse:
    """Start a new navigation session.

    Generates waypoints via the Directions API.  Falls back to
    hardcoded demo routes if the API call fails.

    Args:
        request: Destination details and user start position.

    Returns:
        Session ID, waypoints, and tier information.
    """
    # Try Directions API first
    waypoints = await directions_service.generate_waypoints(
        origin_lat=request.user_lat,
        origin_lng=request.user_lng,
        dest_lat=request.destination_lat,
        dest_lng=request.destination_lng,
    )

    # Fallback to demo routes
    if not waypoints:
        logger.info("Directions API unavailable, using demo route fallback")
        demo_key = next(iter(session_service.DEMO_ROUTES), None)
        if demo_key:
            waypoints = session_service.DEMO_ROUTES[demo_key]
        else:
            raise HTTPException(
                status_code=503,
                detail="Could not generate route. Try again later.",
            )

    session = session_service.create_session(
        destination_name=request.destination_name,
        waypoints=waypoints,
        tier=request.tier,
    )

    return SessionStartResponse(
        session_id=session.session_id,
        destination_name=session.destination_name,
        waypoints=session.waypoints,
        current_waypoint_index=session.current_waypoint_index,
        tier=session.tier,
    )


# ---------------------------------------------------------------------------
# Route description
# ---------------------------------------------------------------------------

@router.post("/describe", response_model=SessionDescribeResponse)
async def describe_session(
    request: SessionDescribeRequest,
) -> SessionDescribeResponse:
    """Generate an accessible route overview.

    Called once before the user starts walking. Gemini produces a
    spoken summary focused on landmarks, textures, and sounds.

    Args:
        request: Session ID.

    Returns:
        Narrative description and structured waypoint summary.
    """
    try:
        session = session_service.require_session(request.session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    description = await gemini_service.generate_route_description(
        waypoints=session.waypoints,
        destination_name=session.destination_name,
    )

    waypoint_summary = [
        {
            "index": i + 1,
            "name": wp.name,
            "hint": wp.landmark_hint,
        }
        for i, wp in enumerate(session.waypoints)
    ]

    return SessionDescribeResponse(
        description=description,
        waypoint_summary=waypoint_summary,
    )


# ---------------------------------------------------------------------------
# Session resume
# ---------------------------------------------------------------------------

@router.post("/resume", response_model=SessionResumeResponse)
async def resume_session(
    request: SessionResumeRequest,
) -> SessionResumeResponse:
    """Restore a session from frontend localStorage data.

    If the session already exists in memory it is returned as-is.
    Otherwise a new in-memory session is created from the client data.

    Args:
        request: Full session state from localStorage.

    Returns:
        Confirmation with session ID.
    """
    session = session_service.resume_session(
        session_id=request.session_id,
        destination_name=request.destination_name,
        waypoints=request.waypoints,
        current_waypoint_index=request.current_waypoint_index,
        completed_waypoint_ids=request.completed_waypoint_ids,
        tier=request.tier,
    )

    return SessionResumeResponse(
        resumed=True,
        session_id=session.session_id,
    )


# ---------------------------------------------------------------------------
# Location update (main game loop)
# ---------------------------------------------------------------------------

@router.post("/update", response_model=UpdateResponse)
async def update_location(request: LocationUpdateRequest) -> UpdateResponse:
    """Process a GPS location update.

    Called every ~2 seconds by the frontend. Calculates distance and
    bearing, checks for distance band changes (which trigger narration),
    and detects waypoint arrivals.

    Args:
        request: Session ID and current GPS coordinates.

    Returns:
        Navigation state including distance, bearing, narration, and
        trigger status.
    """
    try:
        result = session_service.process_location_update(
            session_id=request.session_id,
            lat=request.lat,
            lng=request.lng,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    # Generate narration only when the distance band changed
    narration = None
    if result["band_changed"] and result["current_waypoint"] is not None:
        narration = await gemini_service.generate_narration(
            current_wp=result["current_waypoint"],
            distance_band=result["new_band"].value,
        )

    return UpdateResponse(
        distance_meters=result["distance_meters"],
        bearing_degrees=result["bearing_degrees"],
        triggered=result["triggered"],
        narration=narration,
        next_waypoint=result["next_waypoint"],
        game_complete=result["game_complete"],
    )


# ---------------------------------------------------------------------------
# Advance to next waypoint
# ---------------------------------------------------------------------------

@router.post("/next", response_model=SessionNextResponse)
async def next_waypoint(request: SessionNextRequest) -> SessionNextResponse:
    """Advance to the next waypoint after a trigger.

    Called by the frontend after acknowledging a waypoint arrival.

    Args:
        request: Session ID.

    Returns:
        Next waypoint info, remaining count, and completion status.
    """
    try:
        result = session_service.advance_to_next(request.session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    # Generate transition narration
    narration = None
    if result["next_waypoint"] is not None:
        narration = await gemini_service.generate_narration(
            current_wp=result["next_waypoint"],
            distance_band="far",
        )
    elif result["game_complete"]:
        try:
            session = session_service.require_session(request.session_id)
            narration = f"You've arrived at {session.destination_name}. Well done!"
        except KeyError:
            narration = "You've arrived at your destination. Well done!"

    return SessionNextResponse(
        next_waypoint=result["next_waypoint"],
        waypoints_remaining=result["waypoints_remaining"],
        narration=narration,
        game_complete=result["game_complete"],
    )


# ---------------------------------------------------------------------------
# Get session state (debug / verification)
# ---------------------------------------------------------------------------

@router.get("/{session_id}")
async def get_session(session_id: str):
    """Return the full session state.

    Primarily for debugging and resume verification.

    Args:
        session_id: The session to retrieve.

    Returns:
        Full session object as JSON.
    """
    session = session_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump()
