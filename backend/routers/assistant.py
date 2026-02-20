"""REST assistant router — text/image chat for Basic and Standard tiers.

POST /assistant/message:
    Text-based assistant with optional image input. Uses Gemini function
    calling for ``request_camera`` and ``get_map_image`` tools.

This is the fallback for when WebSocket (Premium tier) isn't available.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from models.schemas import (
    AssistantMessageRequest,
    AssistantResponse,
    ModerationInfo,
)
from services import gemini_service, moderation_service, session_service
from utils.helpers import compress_image, is_valid_base64

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/message", response_model=AssistantResponse)
async def send_message(request: AssistantMessageRequest) -> AssistantResponse:
    """Handle a text-based assistant message.

    Processes the message through moderation, then forwards to Gemini
    with full route context and conversation history. Supports function
    calling for camera requests and map image grounding.

    Args:
        request: Session ID, message text, and optional base64 image.

    Returns:
        Assistant reply, camera request flag, and moderation info.
    """
    # Retrieve session
    try:
        session = session_service.require_session(request.session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check moderation state — is the session restricted?
    if session.moderation_state.restricted:
        return AssistantResponse(
            reply=(
                "This session has been restricted due to repeated policy "
                "violations. Navigation audio and waypoint guidance remain "
                "active. If you need help, please start a new session."
            ),
            needs_camera=False,
            moderation=ModerationInfo(
                warning="Session restricted",
                camera_disabled=session.moderation_state.camera_disabled,
                strikes=session.moderation_state.jailbreak_strikes,
            ),
        )

    # Check for jailbreak attempts
    jailbreak_result = moderation_service.check_jailbreak(
        session=session,
        message=request.message,
    )

    moderation_info = None
    if jailbreak_result["action"] == "restrict":
        return AssistantResponse(
            reply=(
                "I'm here to help with navigation. This session has been "
                "restricted. Navigation guidance remains active."
            ),
            needs_camera=False,
            moderation=ModerationInfo(
                warning=jailbreak_result["reason"],
                camera_disabled=session.moderation_state.camera_disabled,
                strikes=session.moderation_state.jailbreak_strikes,
            ),
        )

    if jailbreak_result["action"] == "warn":
        moderation_info = ModerationInfo(
            warning=jailbreak_result["reason"],
            camera_disabled=session.moderation_state.camera_disabled,
            strikes=session.moderation_state.jailbreak_strikes,
        )

    # Validate and compress image if provided
    image_data = None
    if request.image_base64:
        if not is_valid_base64(request.image_base64):
            raise HTTPException(status_code=422, detail="Invalid image data")
        image_data = compress_image(request.image_base64)

    # Record the user message in conversation history
    session_service.add_conversation_message(
        session_id=request.session_id,
        role="user",
        content=request.message,
        has_image=image_data is not None,
    )

    # Call Gemini
    result = await gemini_service.respond_to_assistant(
        session=session,
        message=request.message,
        image_base64=image_data,
    )

    # If the model returned a text reply, record it
    if result.get("reply"):
        session_service.add_conversation_message(
            session_id=request.session_id,
            role="assistant",
            content=result["reply"],
        )

    return AssistantResponse(
        reply=result.get("reply"),
        needs_camera=result.get("needs_camera", False),
        moderation=moderation_info,
    )
