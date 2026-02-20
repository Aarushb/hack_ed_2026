# Backend Design Document

FastAPI (Python). Read `design-overview.md` first. This document covers folder structure, data models, service logic, and implementation details for every backend operation — including the new voice-to-voice, live video, function calling, and moderation systems.

---

## Responsibilities

- Geo math: given two coordinates, return distance in metres and bearing in degrees
- Session management: create and track user sessions and waypoint progression in memory
- AI orchestration (REST): call Gemini for destination search, route narration, text-based assistant
- AI orchestration (Live): proxy Gemini Multimodal Live API for voice-to-voice + live video
- Function calling: expose backend tools (places, directions, map, location) to the AI model
- Places resolution: call Google Places API to turn NLP-matched place names into real coordinates
- Waypoint generation: call Google Directions API walking steps and map them to Waypoint objects
- Content moderation: jailbreak detection, camera content filtering, strike system
- Serve static audio files for waypoint cues

---

## Folder Structure

```
backend/
├── main.py                    ← App entry, CORS, router registration, lifespan
├── routers/
│   ├── search.py              ← NLP destination search + place resolution
│   ├── session.py             ← Session start, update, next, describe, resume
│   ├── assistant.py           ← REST text/image assistant (Basic tier fallback)
│   └── live.py                ← WebSocket endpoint for Gemini Live API proxy
├── services/
│   ├── geo_service.py         ← Distance and bearing math (geopy)
│   ├── session_service.py     ← In-memory session store, session logic
│   ├── gemini_service.py      ← All REST Gemini API calls (text + multimodal)
│   ├── live_service.py        ← Gemini Multimodal Live API session management
│   ├── places_service.py      ← Google Places API calls (resolve to coords)
│   ├── directions_service.py  ← Google Directions API (auto-generate waypoints)
│   └── moderation_service.py  ← Content safety, jailbreak detection, strike tracking
├── models/
│   └── schemas.py             ← All Pydantic request/response models
├── utils/
│   └── helpers.py             ← Shared utilities (HTML stripping, image compression, etc.)
└── static/
    └── audio/                 ← MP3/OGG waypoint audio cues served as static files
```

---

## Model Choice

**REST calls**: `gemini-2.0-flash` — structured output, function calling, multimodal image input, 1M token context.

**Live sessions**: `gemini-2.0-flash` via Multimodal Live API — bidirectional audio streaming, real-time video input, function calling, low latency.

---

## Data Models (schemas.py)

**Waypoint**
```
id: str
name: str
description: str
lat: float
lng: float
trigger_radius_meters: float   ← default 15
audio_file: str
landmark_hint: str             ← e.g. "kerb cut on your right, traffic crossing sound"
```

**Session**
```
session_id: str
destination_name: str
waypoints: list[Waypoint]
current_waypoint_index: int
completed_waypoint_ids: list[str]
started_at: datetime
last_user_lat: float
last_user_lng: float
last_distance_band: str        ← "far" / "approaching" / "near" / "arrived"
conversation_history: list[dict]
moderation_state: ModerationState
tier: str                      ← "basic" / "standard" / "premium"
```

**ModerationState**
```
warnings: int                  ← 0–3
camera_disabled: bool
jailbreak_strikes: int         ← 0–3
restricted: bool
flagged_messages: list[str]
```

**PlaceCandidate**
```
place_id: str
name: str
address: str
lat: float
lng: float
confidence: float
```

**UpdateResponse**
```
distance_meters: float
bearing_degrees: float
triggered: bool
narration: str | None
next_waypoint: Waypoint | None
game_complete: bool
```

**LiveSessionConfig**
```
session_id: str
tier: str
system_prompt: str
tools: list[dict]
```

---

## Service Logic

### geo_service.py

**Distance:**
```python
distance = geodesic((user_lat, user_lng), (wp_lat, wp_lng)).meters
```

**Bearing** (compass direction from user to waypoint, 0–360):
```python
delta_lng = radians(wp_lng - user_lng)
lat1, lat2 = radians(user_lat), radians(wp_lat)
x = sin(delta_lng) * cos(lat2)
y = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(delta_lng)
bearing = (degrees(atan2(x, y)) + 360) % 360
```

**Distance band** (throttles Gemini narration calls):
```python
def get_distance_band(meters):
    if meters > 100: return "far"
    if meters > 50:  return "approaching"
    if meters > 15:  return "near"
    return "arrived"
```

### directions_service.py

Flow:
1. Call Google Directions API: `origin=(user_lat, user_lng), destination=(dest_lat, dest_lng), mode="walking"`
2. Parse steps from `result[0]["legs"][0]["steps"]`
3. Strip HTML from `html_instructions` → plain text `landmark_hint`
4. Map each step to a Waypoint using `end_location` lat/lng
5. Return waypoint list

Fallback: hardcoded demo routes in `session_service.py` keyed by `place_id`.

### session_service.py

Sessions stored in `sessions: dict[str, Session] = {}`.

**create_session(destination_name, waypoints, tier)** — generate UUID, build Session with ModerationState, store, return.

**process_location_update(session_id, lat, lng)** — geo math, distance band check, narration trigger, waypoint trigger.

**advance_to_next(session_id)** — increment index; if past end, game complete.

**get_session(session_id)** — retrieve session or raise 404.

**update_conversation_history(session_id, role, content)** — append to conversation log.

### gemini_service.py (REST calls)

All non-live Gemini calls. Model: `gemini-2.0-flash`.

- `search_destinations(query, user_lat, user_lng)` → structured output → `list[PlaceCandidate]`
- `generate_route_description(waypoints, destination_name)` → accessibility narration
- `generate_narration(current_wp, distance_band)` → one-sentence TTS guidance
- `respond_to_assistant(session, message, image_base64)` → text assistant with function calling

### live_service.py (NEW — Gemini Multimodal Live API)

Manages real-time voice + video sessions. This is the core of the Premium tier experience.

**Session lifecycle:**
1. Frontend opens WebSocket to `/live/session`
2. Backend creates a Gemini Live API session with system prompt, tools, and voice config
3. Frontend streams audio (user's voice) → backend → Gemini Live
4. Gemini responds with audio (AI voice) → backend → frontend
5. When camera enabled: frontend streams video frames → backend → Gemini Live
6. When model calls a tool: backend executes it, returns result to Gemini, gets response
7. On disconnect: cleanup session, preserve state for reconnection

**System prompt** (crafted for safety and focus):
```
You are NorthStar, a navigation assistant for people with visual impairments.
You guide users along walking routes using landmarks, sounds, textures, and
spatial cues — never distances in metres or cardinal directions.

CRITICAL RULES:
1. NEVER hallucinate. If you are unsure about the user's surroundings, ask them
   to turn on the camera so you can see. User safety depends on your accuracy.
2. Do NOT turn on the camera for everything. Only request it when visual context
   would meaningfully help — obstacles, confusing intersections, verifying landmarks.
3. Be focused and solution-oriented. Brief empathy is fine ("I understand, let me
   help") but don't over-validate. Get to the solution.
4. Reference conversation history naturally. "I see you're headed to..." not
   "Based on our previous exchange..."
5. If neither the camera nor your knowledge can help (truly dynamic real-world
   conditions), say so honestly and advise asking someone nearby or calling for
   assistance.

CURRENT ROUTE CONTEXT:
{route_context}

You have access to these tools — use them when the data you have isn't sufficient:
- get_map_image: Get a map view of the user's position for spatial reasoning
- search_places: Find nearby places if the user asks about something not in your context
- get_directions: Recalculate or check an alternate route
- get_current_location: Get the user's latest GPS coordinates from the session
```

**Tool declarations** (registered with Live API session):
```python
tools = [
    {
        "name": "get_map_image",
        "description": "Fetch a map image of the user's current GPS position to understand their spatial location relative to the route.",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "search_places",
        "description": "Search for a place near the user's location. Use when the user asks about something not in the current route context.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "What to search for"}},
            "required": ["query"]
        }
    },
    {
        "name": "get_directions",
        "description": "Get walking directions between two points. Use to recalculate or verify a route segment.",
        "parameters": {
            "type": "object",
            "properties": {
                "origin_lat": {"type": "number"},
                "origin_lng": {"type": "number"},
                "dest_lat": {"type": "number"},
                "dest_lng": {"type": "number"}
            },
            "required": ["origin_lat", "origin_lng", "dest_lat", "dest_lng"]
        }
    },
    {
        "name": "get_current_location",
        "description": "Get the user's latest GPS coordinates and distance/bearing to their current waypoint target.",
        "parameters": {"type": "object", "properties": {}, "required": []}
    }
]
```

**Function call handling:**
When the model issues a function call during a live session, the backend:
1. Parses the function name and arguments
2. Executes the corresponding backend service call
3. Returns the result as a tool response to the Live API
4. The model incorporates the result and continues its spoken response

This is seamless — the user hears a brief pause while the tool executes, then the AI continues talking with the new information.

### moderation_service.py (NEW)

**check_content(session_id, content_type, content)** — analyses text or image content.
- `content_type`: "text", "image", "video_frame"
- Returns: `{"safe": bool, "reason": str | None, "severity": "none" | "low" | "high"}`

**check_jailbreak(session_id, message, conversation_history)** — pattern detection.
- Looks for: role-play manipulation, instruction override attempts, "ignore previous" patterns
- Severity: "none", "suspicious", "confirmed"
- On "confirmed": increment strike counter

**process_violation(session_id, violation_type, severity)**
- Tracks warnings per session
- `severity == "low"` (accidental): gentle notification, no strike
- `severity == "high"` (deliberate): strike + warning
- At 3 strikes: disable camera / restrict session

**get_moderation_state(session_id)** — returns current warning count, camera status, restriction status.

### places_service.py

**search_place(query)** → `PlaceCandidate | None`
- Calls Google Places API text search
- Returns first result with name, address, lat/lng, place_id

### helpers.py

- `strip_html(text)` — remove HTML tags from Directions API instructions
- `compress_image(base64_data, max_size_bytes)` — resize/compress for Gemini input limits
- `generate_id(prefix)` — short unique ID generator
- `clamp(value, min_val, max_val)` — numeric clamping utility

---

## API Key Management

`.env` file, never committed:
```
GEMINI_API_KEY=...
GOOGLE_MAPS_API_KEY=...
```

Same Maps key works for Places API, Directions API, and Static Maps API.

---

## WebSocket Protocol (live.py)

The `/live/session` WebSocket handles all real-time communication for Premium tier.

**Client → Server messages:**
```json
{"type": "audio", "data": "<base64 PCM audio chunk>"}
{"type": "video_frame", "data": "<base64 JPEG frame>"}
{"type": "camera_on"}
{"type": "camera_off"}
{"type": "text", "message": "..."}
{"type": "location_update", "lat": 43.65, "lng": -79.38}
```

**Server → Client messages:**
```json
{"type": "audio", "data": "<base64 PCM audio chunk>"}
{"type": "transcript", "text": "...", "role": "assistant"}
{"type": "transcript", "text": "...", "role": "user"}
{"type": "tool_call", "name": "get_map_image", "status": "executing"}
{"type": "tool_result", "name": "get_map_image", "status": "complete"}
{"type": "moderation_warning", "message": "...", "strikes": 2}
{"type": "error", "message": "...", "code": "..."}
{"type": "connection_status", "status": "connected" | "reconnecting"}
```

---

## Error Handling

| Condition | HTTP/WS Code | Behaviour |
|---|---|---|
| Session not found | 404 | Clear error message |
| Gemini REST fails | 503 | Narration returns null, does not crash route |
| Gemini Live disconnects | WS close | Auto-reconnect with session state preservation |
| Places/Directions API fails | 503 | Fallback to cached/hardcoded data where possible |
| Image too large | 413 | Reject with size guidance |
| Malformed request | 422 | Auto (Pydantic validation) |
| Moderation violation | 200 | Warning in response, not an HTTP error |
| Connection lost (client) | WS close | Server preserves session for 5 min reconnect window |
| Rate limit exceeded | 429 | Retry-After header, graceful degradation to lower tier |

---

## Running

```
cd backend
uvicorn main:app --reload --port 8000
```

Docs: http://localhost:8000/docs
