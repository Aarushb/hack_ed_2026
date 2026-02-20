"""Google Places API integration.

Resolves Gemini's NLP-matched place names to real GPS coordinates
and structured place data via the Google Places text search API.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import googlemaps
from dotenv import load_dotenv

from models.schemas import PlaceCandidate

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

async def search_place(query: str) -> Optional[PlaceCandidate]:
    """Search for a place by *query* and return the top result.

    Calls the Google Places text-search endpoint. Returns ``None``
    when no results are found.

    Args:
        query: A natural-language place name or address.

    Returns:
        A :class:`PlaceCandidate` with real coordinates, or ``None``.
    """
    try:
        client = _get_client()
        results = client.places(query)

        if not results.get("results"):
            logger.info("Places API returned no results for query=%r", query)
            return None

        place = results["results"][0]
        location = place["geometry"]["location"]

        return PlaceCandidate(
            place_id=place.get("place_id", ""),
            name=place.get("name", query),
            address=place.get("formatted_address", ""),
            lat=location["lat"],
            lng=location["lng"],
        )

    except Exception:
        logger.exception("Places API call failed for query=%r", query)
        return None


async def search_places_nearby(
    query: str,
    lat: float,
    lng: float,
    radius: int = 500,
) -> list[PlaceCandidate]:
    """Search for places near a location.

    Used by the AI assistant's ``search_places`` tool call when it
    needs to find something near the user mid-conversation.

    Args:
        query: What to search for (e.g. "pharmacy", "bus stop").
        lat: Centre latitude.
        lng: Centre longitude.
        radius: Search radius in metres (default 500 m).

    Returns:
        A list of up to 5 :class:`PlaceCandidate` objects.
    """
    try:
        client = _get_client()
        results = client.places_nearby(
            location=(lat, lng),
            radius=radius,
            keyword=query,
        )

        candidates: list[PlaceCandidate] = []
        for place in results.get("results", [])[:5]:
            loc = place["geometry"]["location"]
            candidates.append(
                PlaceCandidate(
                    place_id=place.get("place_id", ""),
                    name=place.get("name", ""),
                    address=place.get("vicinity", ""),
                    lat=loc["lat"],
                    lng=loc["lng"],
                )
            )
        return candidates

    except Exception:
        logger.exception("Nearby search failed for query=%r", query)
        return []
