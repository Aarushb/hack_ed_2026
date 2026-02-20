"""In-memory session management.

Creates, retrieves, updates, and tracks navigation sessions.  Sessions
live in a dict — if the server restarts the frontend's localStorage
copy lets it call ``/session/resume`` to restore state.

Also holds hardcoded demo routes as a fallback when the Directions API
is unavailable.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from models.schemas import (
    ConversationMessage,
    DistanceBand,
    ModerationState,
    Session,
    Tier,
    Waypoint,
)
from services.geo_service import (
    calculate_bearing,
    calculate_distance,
    get_distance_band,
)
from utils.helpers import generate_id

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory session store
# ---------------------------------------------------------------------------

_sessions: dict[str, Session] = {}

# Reconnect window — seconds a session stays alive after last activity
RECONNECT_WINDOW_SECONDS = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Hardcoded demo routes (fallback when Directions API is unavailable)
# ---------------------------------------------------------------------------

DEMO_ROUTES: dict[str, list[Waypoint]] = {
    "demo_nathan_phillips": [
        Waypoint(
            id="wp_demo_01",
            name="Bay and Queen intersection",
            description="Major intersection with pedestrian signals",
            lat=43.6530,
            lng=-79.3810,
            landmark_hint="Pedestrian crossing, traffic sounds on both sides",
        ),
        Waypoint(
            id="wp_demo_02",
            name="Old City Hall entrance",
            description="Heritage building on the east side",
            lat=43.6525,
            lng=-79.3820,
            landmark_hint="Large stone building on your right, steps leading up",
        ),
        Waypoint(
            id="wp_demo_03",
            name="Nathan Phillips Square entrance",
            description="Wide ramp entrance facing the street",
            lat=43.6534,
            lng=-79.3839,
            landmark_hint="Wide ramp, open plaza, fountain sound ahead",
        ),
    ],
}


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------

def create_session(
    destination_name: str,
    waypoints: list[Waypoint],
    tier: Tier = Tier.PREMIUM,
) -> Session:
    """Create a new navigation session and store it in memory.

    Args:
        destination_name: Human-readable destination name.
        waypoints: Ordered list of route waypoints.
        tier: Service tier for this session.

    Returns:
        The newly created :class:`Session`.
    """
    session = Session(
        session_id=generate_id("sess"),
        destination_name=destination_name,
        waypoints=waypoints,
        current_waypoint_index=0,
        completed_waypoint_ids=[],
        started_at=datetime.utcnow(),
        moderation_state=ModerationState(),
        tier=tier,
    )
    _sessions[session.session_id] = session
    logger.info(
        "Created session %s → %s (%d waypoints, tier=%s)",
        session.session_id,
        destination_name,
        len(waypoints),
        tier.value,
    )
    return session


def get_session(session_id: str) -> Optional[Session]:
    """Retrieve a session by ID, or ``None`` if not found."""
    return _sessions.get(session_id)


def require_session(session_id: str) -> Session:
    """Retrieve a session by ID, raising ``KeyError`` if missing.

    Routers translate this to a 404 via exception handler.
    """
    session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Session not found: {session_id}")
    return session


def resume_session(
    session_id: str,
    destination_name: str,
    waypoints: list[Waypoint],
    current_waypoint_index: int,
    completed_waypoint_ids: list[str],
    tier: Tier = Tier.PREMIUM,
) -> Session:
    """Restore a session from frontend localStorage data.

    If the session already exists in memory it is returned as-is.
    Otherwise a new one is created with the provided state.

    Args:
        session_id: The original session ID.
        destination_name: Destination name.
        waypoints: Full waypoint list.
        current_waypoint_index: Where the user left off.
        completed_waypoint_ids: Already-completed waypoint IDs.
        tier: Service tier.

    Returns:
        The restored :class:`Session`.
    """
    existing = _sessions.get(session_id)
    if existing is not None:
        return existing

    session = Session(
        session_id=session_id,
        destination_name=destination_name,
        waypoints=waypoints,
        current_waypoint_index=current_waypoint_index,
        completed_waypoint_ids=completed_waypoint_ids,
        started_at=datetime.utcnow(),
        moderation_state=ModerationState(),
        tier=tier,
    )
    _sessions[session.session_id] = session
    logger.info("Resumed session %s → %s", session_id, destination_name)
    return session


def delete_session(session_id: str) -> None:
    """Remove a session from memory."""
    _sessions.pop(session_id, None)


# ---------------------------------------------------------------------------
# Location update processing
# ---------------------------------------------------------------------------

def process_location_update(
    session_id: str,
    lat: float,
    lng: float,
) -> dict:
    """Process a GPS location update and return navigation state.

    Calculates distance/bearing to the current waypoint, determines the
    distance band, and checks for waypoint trigger.  Returns a dict
    matching the :class:`UpdateResponse` schema — the narration field
    is populated by the router after calling Gemini if the band changed.

    Args:
        session_id: Active session ID.
        lat: User's current latitude.
        lng: User's current longitude.

    Returns:
        Dict with keys: ``distance_meters``, ``bearing_degrees``,
        ``triggered``, ``band_changed``, ``new_band``, ``current_waypoint``,
        ``next_waypoint``, ``game_complete``.
    """
    session = require_session(session_id)

    # Update last-known position
    session.last_user_lat = lat
    session.last_user_lng = lng

    # Check if all waypoints are done
    if session.current_waypoint_index >= len(session.waypoints):
        return {
            "distance_meters": 0.0,
            "bearing_degrees": 0.0,
            "triggered": False,
            "band_changed": False,
            "new_band": DistanceBand.ARRIVED,
            "current_waypoint": None,
            "next_waypoint": None,
            "game_complete": True,
        }

    current_wp = session.waypoints[session.current_waypoint_index]

    distance = calculate_distance(lat, lng, current_wp.lat, current_wp.lng)
    bearing = calculate_bearing(lat, lng, current_wp.lat, current_wp.lng)
    new_band = get_distance_band(distance)

    band_changed = new_band != session.last_distance_band
    if band_changed:
        session.last_distance_band = new_band

    # Check trigger (arrived at waypoint). We do not advance here:
    # /session/next is the single transition point for progression.
    triggered = distance <= current_wp.trigger_radius_meters

    return {
        "distance_meters": round(distance, 1),
        "bearing_degrees": round(bearing, 1),
        "triggered": triggered,
        "band_changed": band_changed,
        "new_band": new_band,
        "current_waypoint": current_wp,
        "next_waypoint": current_wp,
        "game_complete": False,
    }


def advance_to_next(session_id: str) -> dict:
    """Manually advance to the next waypoint.

    Called by the frontend after a trigger event is acknowledged.

    Args:
        session_id: Active session ID.

    Returns:
        Dict with keys: ``next_waypoint``, ``waypoints_remaining``,
        ``game_complete``.
    """
    session = require_session(session_id)

    # If already complete, return terminal state.
    if session.current_waypoint_index >= len(session.waypoints):
        return {
            "next_waypoint": None,
            "waypoints_remaining": 0,
            "game_complete": True,
        }

    # Mark current as complete and move exactly one step.
    current_wp = session.waypoints[session.current_waypoint_index]
    if current_wp.id not in session.completed_waypoint_ids:
        session.completed_waypoint_ids.append(current_wp.id)
    session.current_waypoint_index += 1

    remaining = len(session.waypoints) - session.current_waypoint_index
    game_complete = remaining <= 0
    next_wp = (
        session.waypoints[session.current_waypoint_index]
        if not game_complete
        else None
    )

    session.last_distance_band = DistanceBand.FAR

    return {
        "next_waypoint": next_wp,
        "waypoints_remaining": max(remaining, 0),
        "game_complete": game_complete,
    }


# ---------------------------------------------------------------------------
# Conversation history
# ---------------------------------------------------------------------------

def add_conversation_message(
    session_id: str,
    role: str,
    content: str,
    has_image: bool = False,
) -> None:
    """Append a message to the session's conversation history.

    Args:
        session_id: Active session ID.
        role: ``"user"``, ``"assistant"``, or ``"system"``.
        content: Message text.
        has_image: Whether the message included an image.
    """
    session = require_session(session_id)
    session.conversation_history.append(
        ConversationMessage(
            role=role,
            content=content,
            timestamp=datetime.utcnow(),
            has_image=has_image,
        )
    )


def get_conversation_history(session_id: str) -> list[ConversationMessage]:
    """Return the full conversation history for a session."""
    session = require_session(session_id)
    return session.conversation_history


# ---------------------------------------------------------------------------
# Route context builder (shared by REST assistant + Live API)
# ---------------------------------------------------------------------------

def build_route_context(session: Session) -> str:
    """Build a text block summarising the current route state.

    Used in system prompts and assistant context injection.

    Args:
        session: The active session.

    Returns:
        A multi-line string with route and position information.
    """
    lines = [
        f"Destination: {session.destination_name}",
        f"Total waypoints: {len(session.waypoints)}",
        f"Completed: {len(session.completed_waypoint_ids)}",
    ]

    # Waypoint list with hints
    for i, wp in enumerate(session.waypoints):
        status = "✓" if wp.id in session.completed_waypoint_ids else "○"
        current = " ← CURRENT TARGET" if i == session.current_waypoint_index else ""
        lines.append(
            f"  {status} {i + 1}. {wp.name}: {wp.landmark_hint}{current}"
        )

    if session.current_waypoint_index < len(session.waypoints):
        current_wp = session.waypoints[session.current_waypoint_index]
        distance = calculate_distance(
            session.last_user_lat,
            session.last_user_lng,
            current_wp.lat,
            current_wp.lng,
        )
        lines.extend([
            f"Current target: {current_wp.name}",
            f"  Landmark hint: {current_wp.landmark_hint}",
            f"  Proximity: {session.last_distance_band.value} (~{distance:.0f}m)",
        ])

    lines.append(
        f"User GPS: {session.last_user_lat}, {session.last_user_lng}"
    )

    return "\n".join(lines)
