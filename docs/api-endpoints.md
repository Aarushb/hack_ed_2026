# API Endpoints

All endpoints from `http://localhost:8000` in dev. Frontend calls via `frontend/utils/api.js`. Interactive docs at `http://localhost:8000/docs`.

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

Gemini has geographic training knowledge — given `43.6510, -79.3800` it knows this is downtown Toronto and weights candidates accordingly. It does not need an API call to interpret coordinates; this is built-in knowledge, sufficient for search disambiguation.

---

### POST /session/start

Starts a session after the user picks a destination. Triggers auto-generation of waypoints via Directions API (primary approach). Falls back to hardcoded routes if not achieved.

Request:
```json
{
  "place_id": "ChIJ...",
  "destination_name": "Nathan Phillips Square",
  "destination_lat": 43.6534,
  "destination_lng": -79.3839,
  "user_lat": 43.6510,
  "user_lng": -79.3800
}
```

Response:
```json
{
  "session_id": "abc123",
  "destination_name": "Nathan Phillips Square",
  "waypoints": [
    {
      "id": "wp1",
      "name": "Bay and Queen intersection",
      "lat": 43.6530,
      "lng": -79.3810,
      "trigger_radius_meters": 15,
      "audio_file": "chime_ambient.mp3",
      "landmark_hint": "Pedestrian crossing, traffic sounds on both sides"
    }
  ],
  "current_waypoint_index": 0
}
```

Backend calls `directions_service.generate_waypoints()` using the user's start position and the resolved destination coordinates. Each Directions API step becomes a waypoint with the step's instruction text as `landmark_hint`. Gemini's narration calls then rephrase these in sensory/accessibility language before they're spoken.

---

### POST /session/describe

Generates the accessible route overview once per session, before the user starts walking.

Request:
```json
{ "session_id": "abc123" }
```

Response:
```json
{
  "description": "You're heading northeast toward Nathan Phillips Square, about 8 minutes on foot. Your first landmark is a pedestrian crossing where you'll hear traffic on both sides — bear right there. You'll then pass a raised plaza; keep it on your left. Your destination has a wide ramp entrance facing the street.",
  "waypoint_summary": [
    { "index": 1, "name": "Bay and Queen intersection", "hint": "pedestrian crossing, traffic both sides" },
    { "index": 2, "name": "Nathan Phillips Square entrance", "hint": "wide ramp facing the street" }
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
  "waypoints": [ ... ],
  "current_waypoint_index": 1,
  "completed_waypoint_ids": ["wp1"]
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
  "narration": "Keep walking — listen for the pedestrian crossing signal ahead of you.",
  "next_waypoint": { ... },
  "game_complete": false
}
```

`narration` is only non-null when the user's distance band changed since the last update. When unchanged, `narration` is null and the frontend reuses the previous narration display without re-speaking. This limits Gemini narration calls to 4–5 per waypoint segment.

`bearing_degrees` is used by the frontend to position the HRTF audio source in 3D space. `distance_meters` feeds into the position calculation (farther = panner further from listener = quieter).

If `triggered`: frontend plays arrival chime, shows clue card, calls `/session/next`.

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

Final waypoint:
```json
{
  "next_waypoint": null,
  "waypoints_remaining": 0,
  "narration": "You've arrived at Nathan Phillips Square.",
  "game_complete": true
}
```

---

### GET /session/{session_id}

Current session state. For debugging and resume verification.

---

## AI Assistant

### POST /assistant/message

In-session assistant. Gemini has full route context and can call two tools:

- `request_camera` — when it needs to see the user's physical surroundings
- `get_map_image` — when it needs a map view of the user's position to answer a spatial question. Handled entirely backend-side: the backend fetches a Google Static Maps tile at the user's coordinates and sends it to Gemini as a second image input. The frontend just sends the original message and gets a text reply back.

Request (text only):
```json
{
  "session_id": "abc123",
  "message": "I think I'm at the wrong corner, nothing feels right",
  "image_base64": null
}
```

Request (with camera photo — sent after `needs_camera: true` response):
```json
{
  "session_id": "abc123",
  "message": "Does this look right?",
  "image_base64": "/9j/4AAQ..."
}
```

Response (direct):
```json
{
  "reply": "You should be at the Bay and Queen intersection. The pedestrian crossing signal should be audible — if you're at the right spot, traffic sounds will be on both sides of you. If there's a construction barrier, the next accessible crossing is north on Bay Street.",
  "needs_camera": false
}
```

Response (Gemini called `request_camera`):
```json
{
  "reply": null,
  "needs_camera": true
}
```

Response after `get_map_image` (handled backend-side, transparent to frontend):
```json
{
  "reply": "Looking at your position on the map, you're about 30 metres east of where you need to be. The crossing you want is directly to your west — turn around and walk until you hear the signal.",
  "needs_camera": false
}
```

---

## Utility

### GET /waypoints

All waypoints in the current demo dataset. Useful for debugging.

### GET /

Health check — `{ "status": "ok" }`.

---

## Error Responses

```json
{ "detail": "Session not found" }
```

Status codes: 200, 404, 413 (image too large), 422 (bad request, auto), 503 (Gemini or Google API unavailable).

---

## Gemini Call Budget

| Call | When | Estimated total |
|---|---|---|
| `search_destinations` | Each search | 1 per search |
| `generate_route_description` | Session start | 1 per session |
| `generate_narration` | Distance band changes | ~4–5 per waypoint |
| `session/next` transition | Each waypoint | 1 per waypoint |
| `respond_to_assistant` | Each user message | User-initiated |
| Map image fetched internally | If model calls `get_map_image` | 0 cost for Gemini, 1 Static Maps API call |

A 3-waypoint session with 3 assistant exchanges: roughly 20–28 Gemini calls. Well within free tier for a demo.
