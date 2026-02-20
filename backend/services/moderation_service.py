"""Content moderation and safety service.

Handles jailbreak detection, camera content moderation, and the
strike/warning system.  Designed to protect user safety while being
fair about accidental exposure — a blind user walking past something
inappropriate is treated differently from deliberate abuse.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from models.schemas import ModerationSeverity, ModerationState, Session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Jailbreak detection patterns
# ---------------------------------------------------------------------------

_JAILBREAK_PATTERNS: list[re.Pattern] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"ignore\s+(all\s+)?previous\s+instructions",
        r"forget\s+(all\s+)?your\s+(rules|instructions|guidelines)",
        r"you\s+are\s+now\s+(a|an)\s+(?!navigation)",
        r"pretend\s+you\s+are",
        r"act\s+as\s+if\s+you",
        r"new\s+system\s+prompt",
        r"override\s+(your|the)\s+(system|safety)",
        r"jailbreak",
        r"DAN\s+mode",
        r"developer\s+mode",
        r"do\s+anything\s+now",
    ]
]

# Suspicious but not confirmed — context-dependent
_SUSPICIOUS_PATTERNS: list[re.Pattern] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"what\s+are\s+your\s+(system|hidden)\s+instructions",
        r"reveal\s+your\s+prompt",
        r"tell\s+me\s+your\s+rules",
        r"bypass\s+(the\s+)?filter",
        r"roleplay\s+as",
    ]
]

# Maximum strikes before restriction
MAX_JAILBREAK_STRIKES = 3
MAX_CAMERA_WARNINGS = 3


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def check_jailbreak(
    session: Session,
    message: str,
) -> dict:
    """Analyse a message for jailbreak attempts.

    Checks both the message itself and conversation history patterns.
    A single suspicious message gets logged; repeated attempts escalate.

    Args:
        session: The active session with moderation state.
        message: The user's latest message.

    Returns:
        Dict with ``severity`` (none/suspicious/confirmed), ``reason``,
        and ``action`` (none/warn/restrict).
    """
    mod = session.moderation_state

    # Already restricted — block immediately
    if mod.restricted:
        return {
            "severity": "confirmed",
            "reason": "Session is restricted due to repeated violations",
            "action": "restrict",
        }

    # Check confirmed jailbreak patterns
    for pattern in _JAILBREAK_PATTERNS:
        if pattern.search(message):
            mod.jailbreak_strikes += 1
            mod.flagged_messages.append(message[:200])
            logger.warning(
                "Jailbreak attempt detected in session %s (strike %d): %s",
                session.session_id,
                mod.jailbreak_strikes,
                message[:100],
            )

            if mod.jailbreak_strikes >= MAX_JAILBREAK_STRIKES:
                mod.restricted = True
                return {
                    "severity": "confirmed",
                    "reason": "Repeated jailbreak attempts",
                    "action": "restrict",
                }

            return {
                "severity": "confirmed",
                "reason": "Jailbreak attempt detected",
                "action": "warn",
            }

    # Check suspicious patterns
    for pattern in _SUSPICIOUS_PATTERNS:
        if pattern.search(message):
            logger.info(
                "Suspicious message in session %s: %s",
                session.session_id,
                message[:100],
            )
            return {
                "severity": "suspicious",
                "reason": "Potentially off-topic or probing message",
                "action": "none",
            }

    return {"severity": "none", "reason": None, "action": "none"}


def check_camera_content(
    session: Session,
    analysis_result: str,
) -> dict:
    """Evaluate camera content based on Gemini's analysis.

    The Gemini model analyses camera frames/images for safety. This
    function takes that analysis and decides on the appropriate action.

    Key distinction: accidental exposure (user is blind, walked past
    something) vs deliberate intent (conversation history suggests
    the user is deliberately showing inappropriate content).

    Args:
        session: The active session with moderation state.
        analysis_result: Gemini's content analysis string.

    Returns:
        Dict with ``safe``, ``severity``, ``reason``, ``action``.
    """
    mod = session.moderation_state

    if mod.camera_disabled:
        return {
            "safe": False,
            "severity": ModerationSeverity.HIGH.value,
            "reason": "Camera disabled due to previous violations",
            "action": "block",
        }

    # Check if the analysis indicates problematic content
    # Gemini's safety filters handle the heavy lifting — we check
    # the resulting analysis for flagged indicators
    flagged_terms = [
        "explicit", "violent", "graphic", "inappropriate",
        "nudity", "sexual", "gore", "weapon",
    ]

    analysis_lower = analysis_result.lower()
    is_flagged = any(term in analysis_lower for term in flagged_terms)

    if not is_flagged:
        return {
            "safe": True,
            "severity": ModerationSeverity.NONE.value,
            "reason": None,
            "action": "none",
        }

    # Content was flagged — determine intent
    deliberate = _assess_deliberate_intent(session)

    if deliberate:
        mod.warnings += 1
        mod.flagged_messages.append(f"[camera] {analysis_result[:200]}")
        logger.warning(
            "Deliberate camera violation in session %s (warning %d)",
            session.session_id,
            mod.warnings,
        )

        if mod.warnings >= MAX_CAMERA_WARNINGS:
            mod.camera_disabled = True
            return {
                "safe": False,
                "severity": ModerationSeverity.HIGH.value,
                "reason": (
                    "Camera has been disabled for this session due to "
                    "repeated content violations."
                ),
                "action": "disable_camera",
            }

        return {
            "safe": False,
            "severity": ModerationSeverity.HIGH.value,
            "reason": (
                f"Content flagged. Warning {mod.warnings} of "
                f"{MAX_CAMERA_WARNINGS}."
            ),
            "action": "warn",
        }

    # Accidental exposure — gentle handling
    logger.info(
        "Accidental camera exposure in session %s",
        session.session_id,
    )
    return {
        "safe": False,
        "severity": ModerationSeverity.LOW.value,
        "reason": (
            "The camera picked up something unexpected. "
            "Don't worry — this has been handled automatically."
        ),
        "action": "notify",
    }


def get_moderation_state(session: Session) -> dict:
    """Return the current moderation state for a session.

    Args:
        session: The session to check.

    Returns:
        Dict with warnings, camera status, and restriction status.
    """
    mod = session.moderation_state
    return {
        "warnings": mod.warnings,
        "camera_disabled": mod.camera_disabled,
        "jailbreak_strikes": mod.jailbreak_strikes,
        "restricted": mod.restricted,
        "flagged_count": len(mod.flagged_messages),
    }


def reset_moderation(session: Session) -> None:
    """Reset moderation state (admin/debug use only).

    Args:
        session: The session to reset.
    """
    session.moderation_state = ModerationState()
    logger.info("Moderation state reset for session %s", session.session_id)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _assess_deliberate_intent(session: Session) -> bool:
    """Determine whether flagged content was likely deliberate.

    Examines conversation history for patterns that suggest the user
    is deliberately trying to show inappropriate content rather than
    accidentally encountering it.

    Indicators of deliberate intent:
    - Multiple flagged camera events in quick succession
    - Conversation messages that suggest intentional misuse
    - Previous jailbreak attempts in the same session

    Args:
        session: The session with conversation history.

    Returns:
        ``True`` if the violation appears deliberate.
    """
    mod = session.moderation_state

    # Previous jailbreak attempts → higher likelihood of deliberate misuse
    if mod.jailbreak_strikes > 0:
        return True

    # Multiple camera warnings already → pattern of behaviour
    if mod.warnings > 0:
        return True

    # Check recent conversation for suggestive intent
    recent_messages = [
        msg.content.lower()
        for msg in session.conversation_history[-5:]
        if msg.role == "user"
    ]

    intent_indicators = [
        "show you something",
        "look at this",
        "check this out",
        "what do you think of this",
        "can you see this",
    ]

    for msg in recent_messages:
        for indicator in intent_indicators:
            if indicator in msg:
                # These phrases alone aren't proof — but combined with
                # flagged content they tip the balance
                return True

    # First offence with no other indicators → likely accidental
    return False
