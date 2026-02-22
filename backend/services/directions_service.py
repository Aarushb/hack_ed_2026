"""Google Directions API — auto-generate walking waypoints from a real route.

Takes an origin and destination, calls the Directions API in walking mode,
and maps each step to a Waypoint with the instruction text as the
``landmark_hint``. The hint is later rephrased by Gemini into accessible
sensory language before being spoken to the user.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import googlemaps
from dotenv import load_dotenv

from models.schemas import Waypoint
from utils.helpers import generate_id, strip_html

load_dotenv()
logger = logging.getLogger(__name__)

_gmaps: Optional[googlemaps.Client] = None


def _get_client() -> googlemaps.Client:
    """Lazily initialise the Google Maps client."""
    global _gmaps
    if _gmaps is None:
        api_key = os.getenv("GOOGLE_MAPS_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_MAPS_API_KEY is not set in environment")
        _gmaps = googlemaps.Client(key=api_key)
    return _gmaps


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_waypoints(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> list[Waypoint]:
    """Generate walking waypoints between *origin* and *dest* via Directions API.

    Each step returned by the API becomes a :class:`Waypoint`.  The step's
    HTML instruction is stripped to plain text and used as the
    ``landmark_hint``.

    Falls back to an empty list on failure — the caller should handle
    this by using hardcoded demo routes.

    Args:
        origin_lat: Starting latitude.
        origin_lng: Starting longitude.
        dest_lat: Destination latitude.
        dest_lng: Destination longitude.

    Returns:
        Ordered list of :class:`Waypoint` objects, one per Directions step.
    """
    try:
        client = _get_client()
        results = client.directions(
            origin=(origin_lat, origin_lng),
            destination=(dest_lat, dest_lng),
            mode="walking",
        )

        if not results:
            logger.warning("Directions API returned no results")
            return []

        steps = results[0]["legs"][0]["steps"]
        waypoints: list[Waypoint] = []

        for i, step in enumerate(steps):
            instruction = strip_html(step.get("html_instructions", ""))
            end_loc = step["end_location"]

            wp = Waypoint(
                id=generate_id("wp"),
                name=f"Step {i + 1}",
                description=instruction,
                lat=end_loc["lat"],
                lng=end_loc["lng"],
                trigger_radius_meters=15.0,
                landmark_hint=instruction,
            )
            waypoints.append(wp)

        logger.info(
            "Generated %d waypoints from Directions API", len(waypoints)
        )
        return waypoints

    except Exception:
        logger.exception("Directions API call failed")
        return []


async def get_directions_between(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> Optional[dict]:
    """Get raw directions data between two points.

    Used by the AI assistant's ``get_directions`` tool call to
    recalculate or verify a route segment mid-conversation.

    Args:
        origin_lat: Starting latitude.
        origin_lng: Starting longitude.
        dest_lat: Destination latitude.
        dest_lng: Destination longitude.

    Returns:
        Simplified directions dict with steps, or ``None`` on failure.
    """
    try:
        client = _get_client()
        results = client.directions(
            origin=(origin_lat, origin_lng),
            destination=(dest_lat, dest_lng),
            mode="walking",
        )

        if not results:
            return None

        leg = results[0]["legs"][0]
        steps = [
            {
                "instruction": strip_html(s.get("html_instructions", "")),
                "distance": s["distance"]["text"],
                "duration": s["duration"]["text"],
                "lat": s["end_location"]["lat"],
                "lng": s["end_location"]["lng"],
            }
            for s in leg["steps"]
        ]

        return {
            "total_distance": leg["distance"]["text"],
            "total_duration": leg["duration"]["text"],
            "steps": steps,
        }

    except Exception:
        logger.exception("Directions lookup failed")
        return None
