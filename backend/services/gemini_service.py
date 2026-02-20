"""All REST-based Gemini API calls.

Handles: destination search (structured output), route narration,
text-based assistant with function calling, and map-image grounding.

Model: ``gemini-2.0-flash`` via the ``google-generativeai`` SDK.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Optional

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types

from models.schemas import (
    GeminiPlaceMatch,
    GeminiSearchResult,
    PlaceCandidate,
    Session,
    Waypoint,
)
from services.session_service import build_route_context

load_dotenv()
logger = logging.getLogger(__name__)

MODEL = "gemini-2.0-flash"

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:
    """Lazily initialise the Gemini client."""
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set in environment")
        _client = genai.Client(api_key=api_key)
    return _client


# ===================================================================
# 1. Destination search — structured output
# ===================================================================

async def search_destinations(
    query: str,
    user_lat: float,
    user_lng: float,
) -> list[GeminiPlaceMatch]:
    """Use Gemini to interpret a natural-language destination query.

    Returns structured place matches ranked by relevance and proximity.
    Each match's ``search_query`` is suitable for a Places API text
    search to resolve to real GPS coordinates.

    Args:
        query: User's natural-language destination query.
        user_lat: User's current latitude.
        user_lng: User's current longitude.

    Returns:
        List of :class:`GeminiPlaceMatch` objects (up to 3).
    """
    prompt = (
        f"You are a location search assistant. The user is at coordinates "
        f"({user_lat}, {user_lng}).\n\n"
        f"Return up to 3 place matches for their query, ranked by relevance "
        f"and proximity. Use your geographic knowledge to interpret the "
        f"coordinates — you know where these coordinates are in the world "
        f"and can weight results accordingly.\n\n"
        f'Query: "{query}"'
    )

    try:
        client = _get_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiSearchResult,
            ),
        )

        # Parse the structured response
        import json
        data = json.loads(response.text)
        result = GeminiSearchResult(**data)
        return result.matches

    except Exception:
        logger.exception("Gemini search_destinations failed")
        return []


# ===================================================================
# 2. Route description — accessible narration
# ===================================================================

async def generate_route_description(
    waypoints: list[Waypoint],
    destination_name: str,
) -> str:
    """Generate a plain-English accessible route summary.

    Called once at session start, read aloud before the user begins
    walking. Focuses on landmarks, textures, sounds — not distances
    or compass directions.

    Args:
        waypoints: The full ordered waypoint list.
        destination_name: Human-readable destination name.

    Returns:
        A 3–5 sentence spoken route description.
    """
    wp_text = "\n".join(
        f"- {wp.name}: {wp.landmark_hint}" for wp in waypoints
    )

    prompt = (
        "You are an accessibility navigation assistant. Write a 3–5 sentence "
        "spoken route summary for a person with visual impairment. Focus on "
        "landmarks, textures, sounds, and physical sensations — not distances "
        "or compass directions. This will be read aloud before they start "
        f"walking.\n\nDestination: {destination_name}\nWaypoints:\n{wp_text}"
    )

    try:
        client = _get_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
        )
        return response.text.strip()

    except Exception:
        logger.exception("Gemini route description failed")
        return (
            f"You're heading to {destination_name}. "
            f"There are {len(waypoints)} waypoints along the route. "
            "Follow the audio cues to navigate."
        )


# ===================================================================
# 3. Narration — one sentence per distance band change
# ===================================================================

async def generate_narration(
    current_wp: Waypoint,
    distance_band: str,
) -> str:
    """Generate a single TTS narration sentence.

    Called only when the user's distance band changes, keeping API
    usage to ~4–5 calls per waypoint segment.

    Args:
        current_wp: The waypoint the user is heading toward.
        distance_band: Current proximity band (far/approaching/near/arrived).

    Returns:
        A single narration sentence (under 20 words).
    """
    prompt = (
        f'Guide a visually impaired person to: "{current_wp.name}".\n'
        f'Landmark context: "{current_wp.landmark_hint}".\n'
        f"Current proximity: {distance_band}.\n\n"
        "One sentence. Landmark and sensory cues only. No distances in metres. "
        "No cardinal directions. Under 20 words. "
        'If "arrived": confirm arrival.'
    )

    try:
        client = _get_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
        )
        return response.text.strip()

    except Exception:
        logger.exception("Gemini narration failed")
        if distance_band == "arrived":
            return f"You've arrived at {current_wp.name}."
        return f"Continue toward {current_wp.name}."


# ===================================================================
# 4. Text-based assistant with function calling
# ===================================================================

# Tool declarations for the REST assistant
_ASSISTANT_TOOLS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="request_camera",
            description=(
                "Request a photo from the user's camera to see their "
                "immediate physical surroundings — obstacles, construction, "
                "specific landmarks. Use when you need to see the user's "
                "environment to give accurate guidance."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={},
                required=[],
            ),
        ),
        types.FunctionDeclaration(
            name="get_map_image",
            description=(
                "Get a map image of the user's current GPS position to "
                "understand their location relative to the route and "
                "surrounding streets. Use when coordinates alone aren't "
                "sufficient to answer a positional question."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={},
                required=[],
            ),
        ),
    ]
)

_SYSTEM_PROMPT = (
    "You are NorthStar, the navigation assistant for Wayfind — an app that "
    "guides people with visual impairments using audio cues and voice "
    "narration. Users may be disoriented, anxious, or relying entirely on "
    "what you tell them. Accuracy matters — their safety depends on it.\n\n"
    "CRITICAL RULES:\n"
    "1. NEVER hallucinate. If you are even slightly unsure about the user's "
    "surroundings, call request_camera to see, or get_map_image for spatial "
    "context. Do not guess when the answer affects their safety.\n"
    "2. Be focused and solution-oriented. Brief empathy is fine ('I understand, "
    "let me help') but get to the solution quickly. Don't over-validate.\n"
    "3. Reference conversation history naturally. 'I see you're headed to...' "
    "not 'Based on our previous exchange...'\n"
    "4. If neither tool can help — truly dynamic real-world conditions you "
    "cannot know — say so honestly and advise the user to ask someone nearby "
    "or call for assistance.\n"
    "5. Keep responses concise and clear. The user is listening, not reading."
)


async def respond_to_assistant(
    session: Session,
    message: str,
    image_base64: Optional[str] = None,
) -> dict:
    """Handle a text-based assistant message with optional image.

    This is the REST fallback for Basic/Standard tiers. Premium tier
    uses the Live API WebSocket instead.

    Supports two function-calling tools:
    - ``request_camera``: signals the frontend to capture a photo
    - ``get_map_image``: backend fetches a Static Maps tile and
      re-queries Gemini with it (transparent to frontend)

    Args:
        session: The active navigation session.
        message: User's text message.
        image_base64: Optional base64-encoded image from camera.

    Returns:
        Dict with keys: ``reply``, ``needs_camera``, ``needs_map``.
    """
    route_context = build_route_context(session)

    system = f"{_SYSTEM_PROMPT}\n\nCURRENT ROUTE CONTEXT:\n{route_context}"

    # Build message parts
    parts: list = [message]
    if image_base64:
        parts.append(types.Part.from_bytes(
            data=base64.b64decode(image_base64),
            mime_type="image/jpeg",
        ))

    # Build conversation history for context
    history_contents = []
    for msg in session.conversation_history[-10:]:  # Last 10 messages
        history_contents.append(
            types.Content(
                role="user" if msg.role == "user" else "model",
                parts=[types.Part.from_text(text=msg.content)],
            )
        )

    try:
        client = _get_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=[
                *history_contents,
                types.Content(role="user", parts=[
                    types.Part.from_text(text=p) if isinstance(p, str) else p
                    for p in parts
                ]),
            ],
            config=types.GenerateContentConfig(
                system_instruction=system,
                tools=[_ASSISTANT_TOOLS],
            ),
        )

        # Check for function calls
        for candidate in response.candidates:
            for part in candidate.content.parts:
                if part.function_call:
                    fn_name = part.function_call.name

                    if fn_name == "request_camera":
                        return {
                            "reply": None,
                            "needs_camera": True,
                            "needs_map": False,
                        }

                    if fn_name == "get_map_image":
                        return await _handle_map_image_tool(
                            session, message, system, history_contents
                        )

        # Direct text response
        return {
            "reply": response.text.strip(),
            "needs_camera": False,
            "needs_map": False,
        }

    except Exception:
        logger.exception("Gemini assistant response failed")
        return {
            "reply": (
                "I'm having trouble processing that right now. "
                "Your route and audio guidance are still active."
            ),
            "needs_camera": False,
            "needs_map": False,
        }


# ===================================================================
# 5. Map image grounding (internal, triggered by get_map_image tool)
# ===================================================================

async def _handle_map_image_tool(
    session: Session,
    original_message: str,
    system: str,
    history_contents: list,
) -> dict:
    """Fetch a Static Maps tile and re-query Gemini with it.

    Called when the model issues a ``get_map_image`` function call.
    The frontend never sees this — it just gets back a text reply
    grounded in the map view.

    Args:
        session: Active session with GPS coordinates.
        original_message: The user's original question.
        system: The full system prompt.
        history_contents: Conversation history as Content objects.

    Returns:
        Dict with the map-grounded reply.
    """
    lat = session.last_user_lat
    lng = session.last_user_lng
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")

    map_url = (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lng}&zoom=17&size=400x400&maptype=roadmap"
        f"&markers=color:red%7C{lat},{lng}"
        f"&key={api_key}"
    )

    try:
        async with httpx.AsyncClient() as http:
            resp = await http.get(map_url)
            resp.raise_for_status()
            map_bytes = resp.content

        client = _get_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=[
                *history_contents,
                types.Content(role="user", parts=[
                    types.Part.from_text(text=original_message),
                    types.Part.from_bytes(
                        data=map_bytes,
                        mime_type="image/png",
                    ),
                ]),
            ],
            config=types.GenerateContentConfig(
                system_instruction=(
                    f"{system}\n\nA map image of the user's current GPS "
                    "position is attached. Use it to ground your spatial "
                    "reasoning about their location."
                ),
            ),
        )

        return {
            "reply": response.text.strip(),
            "needs_camera": False,
            "needs_map": False,
        }

    except Exception:
        logger.exception("Map image grounding failed")
        return {
            "reply": (
                "I tried to check the map but couldn't load it. "
                "Based on your GPS position, you should be near "
                f"your current waypoint. Can you describe what's around you?"
            ),
            "needs_camera": False,
            "needs_map": False,
        }
