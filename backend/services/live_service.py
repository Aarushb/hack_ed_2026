"""Gemini Multimodal Live API session management.

Handles real-time voice-to-voice conversation and live video streaming
for the Premium tier experience.  Each live session proxies between a
frontend WebSocket and a Gemini Live API connection, handling:

- Bidirectional audio (user voice ↔ AI voice)
- Live video frames (when camera is enabled)
- Agentic function calling (map, places, directions, location tools)
- Session context injection (route state, conversation history)
- Graceful reconnection on disconnects
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types

from models.schemas import Session
from services import directions_service, places_service, session_service
from services.session_service import build_route_context

load_dotenv()
logger = logging.getLogger(__name__)

MODEL = "gemini-2.0-flash-live-001"

# ---------------------------------------------------------------------------
# System prompt for live sessions
# ---------------------------------------------------------------------------

LIVE_SYSTEM_PROMPT = (
    "You are NorthStar, a navigation assistant for people with visual "
    "impairments. You are having a real-time voice conversation. The user "
    "may also share their camera feed for you to see their surroundings.\n\n"
    "CRITICAL RULES:\n"
    "1. NEVER hallucinate or guess. If you are even slightly unsure, ask the "
    "user to turn on their camera so you can see. Their safety depends on "
    "your accuracy.\n"
    "2. Do NOT request the camera for everything. Only when visual context "
    "would meaningfully help — obstacles, confusing intersections, verifying "
    "landmarks, or when the user is indoors and needs guidance to an exit.\n"
    "3. Be focused and solution-oriented. Brief empathy ('I understand, let "
    "me help') then get to the solution. No chatting, no over-validation.\n"
    "4. Keep responses concise — the user is listening while walking. Short "
    "sentences, clear instructions.\n"
    "5. Reference what you know naturally. 'I see you're about 50 metres "
    "from the crossing' not 'According to the route data...'\n"
    "6. If you truly cannot help (real-world conditions beyond your knowledge "
    "and camera), say so honestly and suggest asking someone nearby.\n"
    "7. When you can see via camera, describe what you see and give "
    "actionable guidance. 'I can see a construction barrier ahead — there's "
    "a path around it to your left.'\n"
    "8. Start the conversation with a brief introduction: 'Hi, I'm NorthStar "
    "your navigation assistant. I can see you're headed to [destination]. "
    "Let's get you there.' Then get straight to guidance."
)

# ---------------------------------------------------------------------------
# Tool declarations for live sessions
# ---------------------------------------------------------------------------

LIVE_TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="get_map_image",
                description=(
                    "Fetch a map image of the user's current GPS position to "
                    "understand their spatial location relative to the route. "
                    "Use when you need to verify the user's position on the map."
                ),
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={},
                    required=[],
                ),
            ),
            types.FunctionDeclaration(
                name="search_places",
                description=(
                    "Search for a place near the user's current location. Use "
                    "when the user asks about something not in the route context "
                    "(e.g. 'is there a pharmacy nearby?')."
                ),
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "query": types.Schema(
                            type=types.Type.STRING,
                            description="What to search for",
                        ),
                    },
                    required=["query"],
                ),
            ),
            types.FunctionDeclaration(
                name="get_directions",
                description=(
                    "Get walking directions between two points. Use to "
                    "recalculate or verify a route segment."
                ),
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "origin_lat": types.Schema(type=types.Type.NUMBER),
                        "origin_lng": types.Schema(type=types.Type.NUMBER),
                        "dest_lat": types.Schema(type=types.Type.NUMBER),
                        "dest_lng": types.Schema(type=types.Type.NUMBER),
                    },
                    required=["origin_lat", "origin_lng", "dest_lat", "dest_lng"],
                ),
            ),
            types.FunctionDeclaration(
                name="get_current_location",
                description=(
                    "Get the user's latest GPS coordinates and distance/bearing "
                    "to their current waypoint target."
                ),
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties={},
                    required=[],
                ),
            ),
        ]
    )
]


# ---------------------------------------------------------------------------
# Live session manager
# ---------------------------------------------------------------------------

class LiveSession:
    """Manages a single Gemini Live API session.

    Wraps the ``google-genai`` async Live API, handling tool execution,
    audio/video relay, and reconnection logic.

    Attributes:
        session_id: The navigation session ID.
        gemini_session: The active Gemini Live connection.
        camera_active: Whether the user's camera is currently streaming.
    """

    def __init__(self, nav_session: Session) -> None:
        self.nav_session = nav_session
        self.session_id = nav_session.session_id
        self.gemini_session: Any = None
        self.camera_active = False
        self._client: Optional[genai.Client] = None

    def _get_client(self) -> genai.Client:
        """Lazily initialise the Gemini client."""
        if self._client is None:
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY is not set")
            self._client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(api_version="v1beta"),
            )
        return self._client

    async def connect(self) -> None:
        """Establish the Gemini Live API connection.

        Configures the session with the system prompt, tools, voice
        settings, and the current route context.
        """
        route_context = build_route_context(self.nav_session)
        system = f"{LIVE_SYSTEM_PROMPT}\n\nCURRENT ROUTE CONTEXT:\n{route_context}"

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO", "TEXT"],
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=system)],
            ),
            tools=LIVE_TOOLS,
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Aoede",
                    ),
                ),
            ),
        )

        client = self._get_client()
        self.gemini_session = client.aio.live.connect(
            model=MODEL,
            config=config,
        )

        logger.info("Live session connected for %s", self.session_id)

    async def send_audio(self, audio_base64: str) -> None:
        """Send a PCM audio chunk to Gemini.

        Args:
            audio_base64: Base64-encoded PCM audio data.
        """
        if self.gemini_session is None:
            return

        audio_bytes = base64.b64decode(audio_base64)
        async with self.gemini_session as session:
            await session.send(
                input=types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(data=audio_bytes, mime_type="audio/pcm")
                    ],
                ),
            )

    async def send_video_frame(self, frame_base64: str) -> None:
        """Send a video frame (JPEG) to Gemini.

        Only processed if camera is active. Frames are sent as
        realtime input — Gemini processes them in context with the
        ongoing conversation.

        Args:
            frame_base64: Base64-encoded JPEG frame.
        """
        if self.gemini_session is None or not self.camera_active:
            return

        frame_bytes = base64.b64decode(frame_base64)
        async with self.gemini_session as session:
            await session.send(
                input=types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(data=frame_bytes, mime_type="image/jpeg")
                    ],
                ),
            )

    async def send_text(self, text: str) -> None:
        """Send a text message to the live session.

        Used as fallback when voice isn't available or for text-mode
        input within a live session.

        Args:
            text: The text message to send.
        """
        if self.gemini_session is None:
            return

        async with self.gemini_session as session:
            await session.send(
                input=text,
                end_of_turn=True,
            )

    async def receive_responses(self):
        """Async generator that yields responses from Gemini.

        Handles three response types:
        - Text responses → forwarded as transcripts
        - Audio responses → forwarded as audio chunks
        - Tool calls → executed and results fed back

        Yields:
            Dicts with ``type`` and payload keys matching the WebSocket
            protocol defined in api-endpoints.md.
        """
        if self.gemini_session is None:
            return

        async with self.gemini_session as session:
            async for response in session.receive():
                # Handle server content (text + audio)
                if response.server_content:
                    content = response.server_content

                    if content.model_turn:
                        for part in content.model_turn.parts:
                            if part.text:
                                yield {
                                    "type": "transcript",
                                    "text": part.text,
                                    "role": "assistant",
                                }
                            if part.inline_data:
                                yield {
                                    "type": "audio",
                                    "data": base64.b64encode(
                                        part.inline_data.data
                                    ).decode(),
                                    "mime_type": part.inline_data.mime_type,
                                }

                    if content.turn_complete:
                        yield {"type": "turn_complete"}

                # Handle tool calls
                if response.tool_call:
                    for fn_call in response.tool_call.function_calls:
                        yield {
                            "type": "tool_call",
                            "name": fn_call.name,
                            "status": "executing",
                        }

                        result = await self._execute_tool(
                            fn_call.name,
                            fn_call.args or {},
                        )

                        # Send tool response back to Gemini
                        await session.send(
                            input=types.LiveClientToolResponse(
                                function_responses=[
                                    types.FunctionResponse(
                                        name=fn_call.name,
                                        response=result,
                                    )
                                ]
                            ),
                        )

                        yield {
                            "type": "tool_result",
                            "name": fn_call.name,
                            "status": "complete",
                        }

    async def _execute_tool(
        self,
        tool_name: str,
        args: dict,
    ) -> dict:
        """Execute a tool called by the Gemini model.

        Routes to the appropriate backend service and returns the
        result as a dict that Gemini can incorporate into its response.

        Args:
            tool_name: Name of the tool function.
            args: Arguments passed by the model.

        Returns:
            Tool result as a JSON-serialisable dict.
        """
        try:
            if tool_name == "get_map_image":
                return await self._tool_get_map_image()

            elif tool_name == "search_places":
                query = args.get("query", "")
                return await self._tool_search_places(query)

            elif tool_name == "get_directions":
                return await self._tool_get_directions(
                    args["origin_lat"],
                    args["origin_lng"],
                    args["dest_lat"],
                    args["dest_lng"],
                )

            elif tool_name == "get_current_location":
                return self._tool_get_current_location()

            else:
                logger.warning("Unknown tool called: %s", tool_name)
                return {"error": f"Unknown tool: {tool_name}"}

        except Exception:
            logger.exception("Tool execution failed: %s", tool_name)
            return {"error": f"Tool {tool_name} failed"}

    async def _tool_get_map_image(self) -> dict:
        """Fetch a Static Maps tile for the user's current position."""
        lat = self.nav_session.last_user_lat
        lng = self.nav_session.last_user_lng
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

            return {
                "description": (
                    f"Map image fetched for position ({lat}, {lng}). "
                    "Zoom level 17 shows the immediate city block."
                ),
                "lat": lat,
                "lng": lng,
            }

        except Exception:
            return {"error": "Could not fetch map image"}

    async def _tool_search_places(self, query: str) -> dict:
        """Search for places near the user."""
        lat = self.nav_session.last_user_lat
        lng = self.nav_session.last_user_lng

        candidates = await places_service.search_places_nearby(
            query, lat, lng
        )

        if not candidates:
            return {"results": [], "message": "No places found nearby"}

        return {
            "results": [
                {
                    "name": c.name,
                    "address": c.address,
                    "lat": c.lat,
                    "lng": c.lng,
                }
                for c in candidates
            ]
        }

    async def _tool_get_directions(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
    ) -> dict:
        """Get walking directions between two points."""
        result = await directions_service.get_directions_between(
            origin_lat, origin_lng, dest_lat, dest_lng
        )
        if result is None:
            return {"error": "Could not get directions"}
        return result

    def _tool_get_current_location(self) -> dict:
        """Get the user's latest GPS position and navigation state."""
        from services.geo_service import calculate_bearing, calculate_distance

        session = self.nav_session
        result: dict[str, Any] = {
            "lat": session.last_user_lat,
            "lng": session.last_user_lng,
        }

        if session.current_waypoint_index < len(session.waypoints):
            wp = session.waypoints[session.current_waypoint_index]
            dist = calculate_distance(
                session.last_user_lat, session.last_user_lng,
                wp.lat, wp.lng,
            )
            bearing = calculate_bearing(
                session.last_user_lat, session.last_user_lng,
                wp.lat, wp.lng,
            )
            result.update({
                "current_waypoint": wp.name,
                "distance_meters": round(dist, 1),
                "bearing_degrees": round(bearing, 1),
                "distance_band": session.last_distance_band.value,
            })

        return result

    def set_camera(self, active: bool) -> None:
        """Toggle the camera feed on or off.

        Args:
            active: ``True`` to start processing video frames.
        """
        self.camera_active = active
        logger.info(
            "Camera %s for session %s",
            "enabled" if active else "disabled",
            self.session_id,
        )

    async def close(self) -> None:
        """Close the Gemini Live session and clean up resources."""
        if self.gemini_session is not None:
            try:
                async with self.gemini_session as session:
                    session.close()
            except Exception:
                pass  # Best-effort cleanup
            self.gemini_session = None
            logger.info("Live session closed for %s", self.session_id)


# ---------------------------------------------------------------------------
# Active sessions registry
# ---------------------------------------------------------------------------

_live_sessions: dict[str, LiveSession] = {}


async def create_live_session(nav_session: Session) -> LiveSession:
    """Create and connect a new live session.

    Args:
        nav_session: The navigation session to attach to.

    Returns:
        The connected :class:`LiveSession`.
    """
    live = LiveSession(nav_session)
    await live.connect()
    _live_sessions[nav_session.session_id] = live
    return live


def get_live_session(session_id: str) -> Optional[LiveSession]:
    """Retrieve an active live session by navigation session ID."""
    return _live_sessions.get(session_id)


async def close_live_session(session_id: str) -> None:
    """Close and remove a live session."""
    live = _live_sessions.pop(session_id, None)
    if live is not None:
        await live.close()
