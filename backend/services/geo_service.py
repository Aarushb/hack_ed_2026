"""Geo math utilities — distance and bearing calculations.

Uses *geopy* for Haversine distance and manual bearing calculation
for compass direction from user to waypoint.
"""

from __future__ import annotations

from math import atan2, cos, degrees, radians, sin

from geopy.distance import geodesic

from models.schemas import DistanceBand


# ---------------------------------------------------------------------------
# Distance
# ---------------------------------------------------------------------------

def calculate_distance(
    user_lat: float,
    user_lng: float,
    target_lat: float,
    target_lng: float,
) -> float:
    """Return the Haversine distance in metres between two coordinates.

    Args:
        user_lat: User's latitude.
        user_lng: User's longitude.
        target_lat: Target latitude.
        target_lng: Target longitude.

    Returns:
        Distance in metres.
    """
    return geodesic((user_lat, user_lng), (target_lat, target_lng)).meters


# ---------------------------------------------------------------------------
# Bearing
# ---------------------------------------------------------------------------

def calculate_bearing(
    user_lat: float,
    user_lng: float,
    target_lat: float,
    target_lng: float,
) -> float:
    """Return the initial compass bearing (0–360°) from user to target.

    0° = North, 90° = East, 180° = South, 270° = West.

    Args:
        user_lat: User's latitude.
        user_lng: User's longitude.
        target_lat: Target latitude.
        target_lng: Target longitude.

    Returns:
        Bearing in degrees (0–360).
    """
    d_lng = radians(target_lng - user_lng)
    lat1 = radians(user_lat)
    lat2 = radians(target_lat)

    x = sin(d_lng) * cos(lat2)
    y = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(d_lng)

    return (degrees(atan2(x, y)) + 360) % 360


# ---------------------------------------------------------------------------
# Distance band (throttles Gemini narration calls)
# ---------------------------------------------------------------------------

def get_distance_band(meters: float) -> DistanceBand:
    """Categorise *meters* into a distance band.

    Band transitions are the only events that trigger a new Gemini
    narration call — this keeps API usage predictable at ~4–5 calls
    per waypoint segment.

    Args:
        meters: Distance in metres from user to current waypoint.

    Returns:
        The corresponding :class:`DistanceBand`.
    """
    if meters > 100:
        return DistanceBand.FAR
    if meters > 50:
        return DistanceBand.APPROACHING
    if meters > 15:
        return DistanceBand.NEAR
    return DistanceBand.ARRIVED
