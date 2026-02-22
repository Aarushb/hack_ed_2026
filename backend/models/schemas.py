"""Pydantic request/response models for the Wayfind API.

All data contracts between frontend and backend are defined here.
Includes models for waypoints, sessions, search, assistant, live sessions,
and content moderation.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DistanceBand(str, Enum):
    """Proximity categories that throttle narration generation."""

    FAR = "far"
    APPROACHING = "approaching"
    NEAR = "near"
    ARRIVED = "arrived"


class Tier(str, Enum):
    """Service tier controlling feature availability."""

    BASIC = "basic"          # Text chat + photo capture
    STANDARD = "standard"    # Voice-to-voice + photo capture
    PREMIUM = "premium"      # Voice-to-voice + live video


class ModerationSeverity(str, Enum):
    """Severity level for moderation events."""

    NONE = "none"
    LOW = "low"    # Accidental — gentle notification, no strike
    HIGH = "high"  # Deliberate — warning + strike


# ---------------------------------------------------------------------------
# Core domain models
# ---------------------------------------------------------------------------

class Waypoint(BaseModel):
    """A single navigation waypoint along the route."""

    id: str
    name: str
    description: str = ""
    lat: float
    lng: float
    trigger_radius_meters: float = 15.0
    audio_file: Optional[str] = None
    landmark_hint: str = ""


class ModerationState(BaseModel):
    """Tracks content moderation warnings and restrictions for a session."""

    warnings: int = 0
    camera_disabled: bool = False
    jailbreak_strikes: int = 0
    restricted: bool = False
    flagged_messages: list[str] = Field(default_factory=list)


class ConversationMessage(BaseModel):
    """A single message in the assistant conversation history."""

    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    has_image: bool = False


class Session(BaseModel):
    """Full navigation session state."""

    session_id: str
    destination_name: str
    waypoints: list[Waypoint]
    current_waypoint_index: int = 0
    completed_waypoint_ids: list[str] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_user_lat: float = 0.0
    last_user_lng: float = 0.0
    last_distance_band: DistanceBand = DistanceBand.FAR
    conversation_history: list[ConversationMessage] = Field(default_factory=list)
    moderation_state: ModerationState = Field(default_factory=ModerationState)
    tier: Tier = Tier.PREMIUM


class PlaceCandidate(BaseModel):
    """A resolved destination candidate with real coordinates."""

    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    confidence: float = 0.0


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SearchRequest(BaseModel):
    """POST /search/destination"""

    query: str
    user_lat: float
    user_lng: float


class SessionStartRequest(BaseModel):
    """POST /session/start"""

    place_id: str
    destination_name: str
    destination_lat: float
    destination_lng: float
    user_lat: float
    user_lng: float
    tier: Tier = Tier.PREMIUM


class SessionDescribeRequest(BaseModel):
    """POST /session/describe"""

    session_id: str


class SessionResumeRequest(BaseModel):
    """POST /session/resume"""

    session_id: str
    destination_name: str
    waypoints: list[Waypoint]
    current_waypoint_index: int = 0
    completed_waypoint_ids: list[str] = Field(default_factory=list)
    tier: Tier = Tier.PREMIUM


class LocationUpdateRequest(BaseModel):
    """POST /session/update"""

    session_id: str
    lat: float
    lng: float


class SessionNextRequest(BaseModel):
    """POST /session/next"""

    session_id: str


class AssistantMessageRequest(BaseModel):
    """POST /assistant/message"""

    session_id: str
    message: str
    image_base64: Optional[str] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class SearchResponse(BaseModel):
    """Response for destination search."""

    candidates: list[PlaceCandidate]


class SessionStartResponse(BaseModel):
    """Response after starting a session."""

    session_id: str
    destination_name: str
    waypoints: list[Waypoint]
    current_waypoint_index: int
    tier: Tier


class SessionDescribeResponse(BaseModel):
    """Accessible route description."""

    description: str
    waypoint_summary: list[dict]


class SessionResumeResponse(BaseModel):
    """Response after resuming a session."""

    resumed: bool
    session_id: str


class UpdateResponse(BaseModel):
    """Response for each GPS location update."""

    distance_meters: float
    bearing_degrees: float
    triggered: bool
    narration: Optional[str] = None
    next_waypoint: Optional[Waypoint] = None
    game_complete: bool = False


class SessionNextResponse(BaseModel):
    """Response after advancing to the next waypoint."""

    next_waypoint: Optional[Waypoint] = None
    waypoints_remaining: int
    narration: Optional[str] = None
    game_complete: bool = False


class ModerationInfo(BaseModel):
    """Moderation details included in assistant responses when relevant."""

    warning: str
    camera_disabled: bool
    strikes: int


class AssistantResponse(BaseModel):
    """Response from the text-based assistant."""

    reply: Optional[str] = None
    needs_camera: bool = False
    moderation: Optional[ModerationInfo] = None


# ---------------------------------------------------------------------------
# Gemini structured output schemas (used internally by gemini_service)
# ---------------------------------------------------------------------------

class GeminiPlaceMatch(BaseModel):
    """Single place match from Gemini's structured search output."""

    name: str
    address: str
    search_query: str  # Clean name for Places API lookup
    confidence: float


class GeminiSearchResult(BaseModel):
    """Structured output schema for Gemini destination search."""

    matches: list[GeminiPlaceMatch]
