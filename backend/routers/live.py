"""Live session router — WebSocket endpoint for Gemini Multimodal Live API.

WS /live/session:
    Real-time bidirectional communication for voice-to-voice and live
    video streaming. Proxies between the frontend WebSocket and the
    Gemini Live API, handling audio relay, video frames, tool calls,
    and moderation.
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services import live_service, moderation_service, session_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/session")
async def live_session_ws(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time AI communication.

    Protocol:
        Client → Server: JSON messages with ``type`` field
            - ``audio``: PCM audio chunk (base64 in ``data``)
            - ``video_frame``: JPEG frame (base64 in ``data``)
            - ``camera_on``: Enable camera processing
            - ``camera_off``: Disable camera processing
            - ``text``: Text message fallback (``message`` field)
            - ``location_update``: GPS update (``lat``, ``lng``)

        Server → Client: JSON messages with ``type`` field
            - ``audio``: AI voice response chunk
            - ``transcript``: Speech transcription
            - ``tool_call``: Tool execution notification
            - ``tool_result``: Tool execution complete
            - ``moderation_warning``: Content safety alert
            - ``error``: Error notification
            - ``connection_status``: Connection state changes

    Query params:
        session_id: Required. The navigation session to connect to.
    """
    await websocket.accept()

    # Extract session_id from query params
    session_id = websocket.query_params.get("session_id")
    if not session_id:
        await websocket.send_json({
            "type": "error",
            "message": "session_id query parameter is required",
            "code": "MISSING_SESSION_ID",
        })
        await websocket.close(code=4000)
        return

    # Validate the navigation session exists
    nav_session = session_service.get_session(session_id)
    if nav_session is None:
        await websocket.send_json({
            "type": "error",
            "message": "Session not found",
            "code": "SESSION_NOT_FOUND",
        })
        await websocket.close(code=4004)
        return

    # Check if session is restricted
    if nav_session.moderation_state.restricted:
        await websocket.send_json({
            "type": "error",
            "message": "Session restricted due to policy violations",
            "code": "SESSION_RESTRICTED",
        })
        await websocket.close(code=4003)
        return

    # Create the Gemini Live session
    live: live_service.LiveSession | None = None
    try:
        live = await live_service.create_live_session(nav_session)
        await websocket.send_json({
            "type": "connection_status",
            "status": "connected",
        })
    except Exception as exc:
        logger.exception("Failed to create live session for %s", session_id)
        await websocket.send_json({
            "type": "error",
            "message": f"Failed to initialise AI session: {exc}",
            "code": "LIVE_SESSION_INIT_FAILED",
        })
        await websocket.close(code=5003)
        return

    # Run send and receive loops concurrently
    try:
        receive_task = asyncio.create_task(
            _client_receive_loop(websocket, live, nav_session)
        )
        send_task = asyncio.create_task(
            _gemini_send_loop(websocket, live)
        )

        # Wait for either task to complete (usually means disconnect)
        done, pending = await asyncio.wait(
            [receive_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Cancel the other task
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    except WebSocketDisconnect:
        logger.info("Client disconnected from live session %s", session_id)

    except Exception:
        logger.exception("Error in live session %s", session_id)
        try:
            await websocket.send_json({
                "type": "error",
                "message": "An unexpected error occurred",
                "code": "INTERNAL_ERROR",
            })
        except Exception:
            pass

    finally:
        # Clean up the live session
        await live_service.close_live_session(session_id)
        logger.info("Live session %s cleaned up", session_id)


async def _client_receive_loop(
    websocket: WebSocket,
    live: live_service.LiveSession,
    nav_session,
) -> None:
    """Receive messages from the frontend and forward to Gemini.

    Handles all client → server message types defined in the protocol.

    Args:
        websocket: The client WebSocket connection.
        live: The active Gemini Live session.
        nav_session: The navigation session for moderation checks.
    """
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON",
                    "code": "INVALID_JSON",
                })
                continue

            msg_type = msg.get("type", "")

            if msg_type == "audio":
                audio_data = msg.get("data", "")
                if audio_data:
                    await live.send_audio(audio_data)

            elif msg_type == "video_frame":
                # Only process if camera is active
                if live.camera_active:
                    frame_data = msg.get("data", "")
                    if frame_data:
                        await live.send_video_frame(frame_data)

            elif msg_type == "camera_on":
                # Check if camera is disabled by moderation
                if nav_session.moderation_state.camera_disabled:
                    await websocket.send_json({
                        "type": "moderation_warning",
                        "message": (
                            "Camera has been disabled for this session "
                            "due to content policy violations."
                        ),
                        "strikes": nav_session.moderation_state.warnings,
                    })
                else:
                    live.set_camera(True)

            elif msg_type == "camera_off":
                live.set_camera(False)

            elif msg_type == "text":
                text = msg.get("message", "")
                if text:
                    # Run moderation check on text input
                    jailbreak = moderation_service.check_jailbreak(
                        session=nav_session,
                        message=text,
                    )

                    if jailbreak["action"] in ("warn", "restrict"):
                        await websocket.send_json({
                            "type": "moderation_warning",
                            "message": jailbreak["reason"],
                            "strikes": nav_session.moderation_state.jailbreak_strikes,
                        })

                        if jailbreak["action"] == "restrict":
                            await websocket.send_json({
                                "type": "error",
                                "message": "Session restricted",
                                "code": "SESSION_RESTRICTED",
                            })
                            return

                    # Record in conversation history
                    session_service.add_conversation_message(
                        session_id=nav_session.session_id,
                        role="user",
                        content=text,
                    )
                    await live.send_text(text)

            elif msg_type == "location_update":
                lat = msg.get("lat")
                lng = msg.get("lng")
                if lat is not None and lng is not None:
                    nav_session.last_user_lat = lat
                    nav_session.last_user_lng = lng

            elif msg_type == "ping":
                # Keepalive ping from client — acknowledge but no action needed.
                pass

            else:
                logger.debug("Unknown message type: %s", msg_type)

    except WebSocketDisconnect:
        raise
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Error in client receive loop")
        raise


async def _gemini_send_loop(
    websocket: WebSocket,
    live: live_service.LiveSession,
) -> None:
    """Receive responses from Gemini and forward to the frontend.

    Handles audio responses, transcripts, tool call notifications,
    and turn completion signals.

    Args:
        websocket: The client WebSocket connection.
        live: The active Gemini Live session.
    """
    try:
        async for response in live.receive_responses():
            try:
                await websocket.send_json(response)

                # Record assistant transcripts in conversation history
                if (
                    response.get("type") == "transcript"
                    and response.get("role") == "assistant"
                ):
                    session_service.add_conversation_message(
                        session_id=live.session_id,
                        role="assistant",
                        content=response.get("text", ""),
                    )

            except Exception:
                logger.debug("Failed to send response to client")
                break

    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Error in Gemini send loop")
        try:
            await websocket.send_json({
                "type": "connection_status",
                "status": "reconnecting",
            })
        except Exception:
            pass
