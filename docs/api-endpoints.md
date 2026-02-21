# API Endpoints

All endpoints from `http://localhost:8000/api` in dev. Frontend calls via `frontend/utils/api.js`. Interactive docs at `http://localhost:8000/docs`.

---

## Search & Session Setup

### POST /search/destination

Takes a natural-language query and user's current GPS coordinates. Gemini interprets the query geographically, returns ranked candidates, each resolved to real coordinates via Places API.

Request:
```json
{
  "query": "the big park with the fountain near city hall",
  "user_lat": 43.6510,
  "user_lng": -79.3800
}
```

Response:
```json
{
  "candidates": [
    {
      "place_id": "ChIJ...",
      "name": "Nathan Phillips Square",
      "address": "100 Queen St W, Toronto",
      "lat": 43.6534,
      "lng": -79.3839,
      "confidence": 0.91
    }
  ]
}
```

---

### POST /session/start

Starts a session after the user picks a destination. Triggers auto-generation of waypoints via Directions API.

Request:
```json
{
  "place_id": "ChIJ...",
  "destination_name": "Nathan Phillips Square",
  "destination_lat": 43.6534,
  "destination_lng": -79.3839,
  "user_lat": 43.6510,
  "user_lng": -79.3800,
  "tier": "premium"
}
```

Response:
```json
{
  "session_id": "abc123",
  "destination_name": "Nathan Phillips Square",
  "waypoints": [...],
  "current_waypoint_index": 0,
  "tier": "premium"
}
```

---

### POST /session/describe

Generates the accessible route overview once per session, before walking.

Request:
```json
{ "session_id": "abc123" }
```

Response:
```json
{
  "description": "You're heading northeast toward Nathan Phillips Square...",
  "waypoint_summary": [
    { "index": 1, "name": "Bay and Queen intersection", "hint": "pedestrian crossing, traffic both sides" }
  ]
}
```

---

### POST /session/resume

Called on page reload if localStorage has a saved session.

Request:
```json
{
  "session_id": "abc123",
  "destination_name": "Nathan Phillips Square",
  "waypoints": [...],
  "current_waypoint_index": 1,
  "completed_waypoint_ids": ["wp1"],
  "tier": "premium"
}
```

Response:
```json
{ "resumed": true, "session_id": "abc123" }
```

---

## Active Session

### POST /session/update

Main game loop. Called every ~2 seconds with user's GPS position.

Request:
```json
{
  "session_id": "abc123",
  "lat": 43.6521,
  "lng": -79.3808
}
```

Response:
```json
{
  "distance_meters": 62.3,
  "bearing_degrees": 34.7,
  "triggered": false,
  "narration": "Keep walking — listen for the pedestrian crossing signal ahead.",
  "next_waypoint": { ... },
  "game_complete": false
}
```

`narration` is only non-null when the distance band changed.

---

### POST /session/next

Advances to the next waypoint after trigger.

Request:
```json
{ "session_id": "abc123" }
```

Response:
```json
{
  "next_waypoint": { ... },
  "waypoints_remaining": 1,
  "narration": "Well done. Now head toward the fountain entrance.",
  "game_complete": false
}
```

---

### GET /session/{session_id}

Current session state. For debugging and resume verification.

---

## AI Assistant (REST — Basic/Standard tier fallback)

### POST /assistant/message

Text-based assistant with optional image. Used by Basic and Standard tiers, or as fallback when WebSocket is unavailable.

Request (text only):
```json
{
  "session_id": "abc123",
  "message": "I think I'm at the wrong corner",
  "image_base64": null
}
```

Response (direct):
```json
{
  "reply": "You should be at the Bay and Queen intersection...",
  "needs_camera": false,
  "moderation": null
}
```

Response (model wants camera):
```json
{
  "reply": null,
  "needs_camera": true,
  "moderation": null
}
```

Response (with moderation warning):
```json
{
  "reply": "...",
  "needs_camera": false,
  "moderation": {
    "warning": "Content flagged. Strike 1 of 3.",
    "camera_disabled": false,
    "strikes": 1
  }
}
```

---

## Live Session (WebSocket — Premium tier)

### WS /api/live/session

Real-time bidirectional communication for voice-to-voice + live video.

**Connection:** `ws://localhost:8000/api/live/session?session_id=abc123`

**Client → Server:**
| Type | Payload | Description |
|---|---|---|
| `audio` | `{data: base64}` | PCM audio chunk from user's microphone |
| `video_frame` | `{data: base64}` | JPEG frame from camera |
| `camera_on` | `{}` | User enabled camera |
| `camera_off` | `{}` | User disabled camera |
| `text` | `{message: str}` | Text input fallback |
| `location_update` | `{lat, lng}` | GPS position update |

**Server → Client:**
| Type | Payload | Description |
|---|---|---|
| `audio` | `{data: base64}` | AI voice response audio chunk |
| `transcript` | `{text, role}` | Transcription of speech (user or assistant) |
| `tool_call` | `{name, status}` | Tool execution notification |
| `tool_result` | `{name, status}` | Tool execution complete |
| `moderation_warning` | `{message, strikes}` | Content moderation alert |
| `error` | `{message, code}` | Error notification |
| `connection_status` | `{status}` | Connection state updates (`connected`, `reconnecting`) |
| `turn_complete` | `{}` | Marks the end of a model turn |

---

## Utility

### GET /api

Health check — `{ "status": "ok" }`.

---

## Error Responses

```json
{ "detail": "Session not found" }
```

Status codes: 200, 404, 413 (image too large), 422 (bad request), 429 (rate limited), 503 (upstream API unavailable).

---

## Token Budget

| Call | When | Estimated total |
|---|---|---|
| `search_destinations` | Each search | 1 per search |
| `generate_route_description` | Session start | 1 per session |
| `generate_narration` | Distance band changes | ~4–5 per waypoint |
| `session/next` transition | Each waypoint | 1 per waypoint |
| `respond_to_assistant` (REST) | Each text message | User-initiated |
| Live API session | Entire navigation | 1 session per route |
| Map image via tool call | When model decides | 0 Gemini cost, 1 Static Maps call |
| Places via tool call | When model decides | 1 Places API call |

A 3-waypoint session with voice-to-voice and 2 camera activations: roughly 20–30 REST calls + 1 Live session of ~5–10 min. Well within free tier (1,500 req/day) for a hackathon demo.
