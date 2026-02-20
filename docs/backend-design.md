# Backend Design Document

FastAPI (Python). Read `design-overview.md` first. This document covers folder structure, data models, service logic, and pseudocode for every meaningful backend operation.

---

## Responsibilities

- Geo math: given two coordinates, return distance in metres and bearing in degrees
- Session management: create and track user sessions and waypoint progression in memory
- AI orchestration: call Gemini for destination search, route narration, assistant responses, and camera-based visual grounding
- Places resolution: call Google Places API to turn NLP-matched place names into real coordinates
- Waypoint generation: call Google Directions API walking steps and map them to Waypoint objects (primary approach; hardcoded routes are the fallback if this isn't achieved)
- Serve static audio files for waypoint cues

---

## Folder Structure

```
backend/
├── main.py                  ← App entry, CORS, router registration
├── routers/
│   ├── search.py            ← NLP destination search + place resolution
│   ├── session.py           ← Session start, update, next, describe, resume
│   └── assistant.py         ← In-session AI assistant (text + image)
├── services/
│   ├── geo_service.py       ← Distance and bearing math (geopy)
│   ├── session_service.py   ← In-memory session store, session logic
│   ├── gemini_service.py    ← All Gemini API calls (text + multimodal)
│   ├── places_service.py    ← Google Places API calls (resolve to coords)
│   └── directions_service.py ← Google Directions API (auto-generate waypoints)
├── models/
│   └── schemas.py           ← All Pydantic request/response models
├── utils/
│   └── helpers.py           ← Shared utilities
└── static/
    └── audio/               ← MP3/OGG waypoint audio cues served as static files
```

---

## Model Choice: Gemini 3 Flash

Model string: `gemini-3-flash-preview`

Supports: structured output via JSON schema, function calling with strict schema validation, multimodal image input (base64), 1M token context, dynamic thinking (adjusts reasoning depth to task complexity automatically).

Prompts are written to be concise and direct — Gemini 3 responds better to clear instructions than to elaborate prompt engineering. Trust the model to reason; give it the data it needs.

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
narration: str | None          ← only non-null when distance band changed
next_waypoint: Waypoint | None
game_complete: bool
```

---

## Service Logic

### geo_service.py

**Distance:**
```
distance = geodesic((user_lat, user_lng), (wp_lat, wp_lng)).meters
```

**Bearing** (compass direction from user to waypoint, 0–360):
```
delta_lng = radians(wp_lng - user_lng)
lat1, lat2 = radians(user_lat), radians(wp_lat)
x = sin(delta_lng) * cos(lat2)
y = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(delta_lng)
bearing = (degrees(atan2(x, y)) + 360) % 360
```

**Distance band** (throttles Gemini narration calls):
```
def get_distance_band(meters):
    if meters > 100: return "far"
    if meters > 50:  return "approaching"
    if meters > 15:  return "near"
    return "arrived"
```

### directions_service.py

**Goal: auto-generate waypoints from a real walking route.** This is the primary approach. If it isn't completed by the hackathon deadline, fall back to hardcoded routes.

Flow:
1. Call Google Directions API: `gmaps.directions(origin=(user_lat, user_lng), destination=(dest_lat, dest_lng), mode="walking")`
2. The API returns a list of steps, each with an HTML instruction string and an end location (lat, lng)
3. Strip HTML tags from each step instruction to get a plain-text description
4. Map each step to a Waypoint object — the step instruction becomes the `landmark_hint`
5. Assign a default `audio_file`, a `trigger_radius_meters` of 15, and generate a short `id`
6. Return the waypoint list

The landmark hints from Directions API steps will be distance/direction based ("Turn left onto Bay St") rather than sensory/landmark based. That's acceptable as the raw data — the `generate_narration` call then takes that hint and rephrases it in accessible sensory language before it's spoken to the user.

Fallback if Directions API is not integrated in time: hardcode demo routes in `session_service.py` as a dict keyed by `place_id`. Each entry has a hand-written waypoint list with well-crafted `landmark_hint` strings.

### session_service.py

Sessions stored in `sessions: dict[str, Session] = {}`.

**create_session(destination_name, waypoints)** — generate UUID, build Session, store, return.

**process_location_update(session_id, lat, lng)**
- Look up session
- Call geo_service for distance and bearing to current target waypoint
- Get new distance band
- If band changed: call `gemini_service.generate_narration()`, update stored band
- If band unchanged: return `narration = None`
- Check trigger (distance < trigger_radius)
- If triggered: mark complete, increment index, reset band to "far"
- Return UpdateResponse

**advance_to_next(session_id)** — increment index; if past end, game complete.

### gemini_service.py

All Gemini calls. Model: `gemini-3-flash-preview`. Uses the `google-generativeai` Python SDK.

---

**search_destinations(query, user_lat, user_lng) → list[PlaceCandidate]**

Uses structured output to guarantee clean JSON — no parsing guesswork.

Pydantic schema:
```python
class PlaceMatch(BaseModel):
    name: str
    address: str
    search_query: str   # clean name for Places API
    confidence: float

class SearchResult(BaseModel):
    matches: list[PlaceMatch]
```

Prompt:
```
You are a location search assistant. The user is at coordinates ({user_lat}, {user_lng}).

Return up to 3 place matches for their query, ranked by relevance and proximity.
Use your geographic knowledge to interpret the coordinates — you know where these
coordinates are in the world and can weight results accordingly.

Query: "{query}"
```

Note on what the model knows: Gemini has strong geographic training data. Given coordinates like `43.6530, -79.3810`, it knows this is in downtown Toronto near Bay and Queen. It does not need to make an external API call to interpret coordinates — this is knowledge it already has, and it's sufficient for weighting search candidates geographically. For example, "the big park with the fountain" at those coordinates would correctly rank Nathan Phillips Square over a park in another city.

The resulting `search_query` strings are each sent to `places_service.search_place()` to get real GPS coordinates. Results are merged and returned as `PlaceCandidate` objects.

---

**generate_route_description(waypoints, destination_name) → str**

Called once at session start.

Prompt:
```
You are an accessibility navigation assistant. Write a 3–5 sentence spoken route
summary for a person with visual impairment. Focus on landmarks, textures, sounds,
and physical sensations — not distances or compass directions. This will be read
aloud before they start walking.

Destination: {destination_name}
Waypoints: {name and landmark_hint for each}
```

---

**generate_narration(current_wp, distance_band) → str**

One sentence for TTS. Called only when distance band changes.

Prompt:
```
Guide a visually impaired person to: "{current_wp.name}".
Landmark context: "{current_wp.landmark_hint}".
Current proximity: {distance_band}.

One sentence. Landmark and sensory cues only. No distances in metres.
No cardinal directions. Under 20 words. If "arrived": confirm arrival.
```

---

**respond_to_assistant(session, message, image_base64) → dict**

The most context-rich call. Uses **two function tools**: `request_camera` and `get_map_image`.

**Why two tools:**

`request_camera` — the model calls this when it needs to see the user's physical surroundings (obstacles, construction, ambiguous environment). The frontend opens the camera and resends with the photo.

`get_map_image` — the model calls this when it needs a map view of the user's current GPS location to understand their spatial position relative to the route. The backend calls Google Static Maps API with the user's coordinates, gets a map tile image, and sends it back to Gemini as a second multimodal input alongside the original message. This is the correct answer to the question of whether coordinates alone are enough context: they usually are (Gemini knows where those coordinates are), but for complex positional questions the model can now request a map snapshot to verify.

Function declarations:
```python
request_camera_fn = {
    "name": "request_camera",
    "description": "Request a photo from the user's camera to see their immediate physical surroundings — obstacles, construction, specific landmarks. Use when you need to see the user's environment to give accurate guidance.",
    "parameters": {"type": "object", "properties": {}, "required": []}
}

get_map_image_fn = {
    "name": "get_map_image",
    "description": "Get a map image of the user's current GPS position to understand their location relative to the route and surrounding streets. Use when coordinates alone aren't sufficient to answer a positional question.",
    "parameters": {"type": "object", "properties": {}, "required": []}
}
```

System prompt (full context, sent with every assistant call):
```
You are the navigation assistant for Wayfind, an app that guides people with
visual impairments using audio cues and voice narration. Users may be disoriented,
anxious, or relying entirely on what you tell them. Accuracy matters.

Current route:
- Destination: {destination_name}
- Full waypoints with landmark hints: {serialised list}
- Last completed: {name or "none yet"}
- Current target: {next_waypoint.name}
  Landmark hint: {next_waypoint.landmark_hint}
- User GPS: {lat}, {lng} (you have geographic knowledge of this location)
- Proximity: {distance_band} (~{distance}m from target)

Answer specifically and helpfully. If you need to see the user's surroundings,
call request_camera. If you need a map view of their position, call get_map_image.
If you're uncertain and neither tool would help — for example, real-time conditions
you have no way of knowing — say so honestly and advise the user to ask someone
nearby or call for assistance. Do not guess when the answer affects their safety.
```

Return values:
- Direct answer → `{"reply": text, "needs_camera": False, "needs_map": False}`
- Model calls `request_camera` → `{"needs_camera": True}`
- Model calls `get_map_image` → backend fetches map tile from Google Static Maps, sends it back to Gemini as a second image alongside the conversation, gets a response → `{"reply": text}`
- Image provided (second call after camera capture) → straight multimodal response → `{"reply": text}`

The `get_map_image` flow is handled entirely backend-side — the frontend just sends the original message and gets back a text reply. It doesn't need to know a map image was fetched in the middle.

**Fetching the map tile (inside get_map_image handling):**
```python
map_url = (
    f"https://maps.googleapis.com/maps/api/staticmap"
    f"?center={lat},{lng}&zoom=17&size=400x400&maptype=roadmap"
    f"&markers=color:red%7C{lat},{lng}"
    f"&key={GOOGLE_MAPS_API_KEY}"
)
# fetch map_url as bytes, encode to base64, send to Gemini as image part
```

Zoom level 17 gives a city-block-scale view — close enough to show the intersection the user is at without being too zoomed out to be useful.

---

### places_service.py

**search_place(query) → PlaceCandidate | None**
- Calls `gmaps.places(query)` text search
- Returns first result: name, formatted_address, geometry.location, place_id
- Returns None if no results

### directions_service.py (new)

**generate_waypoints(origin_lat, origin_lng, dest_lat, dest_lng) → list[Waypoint]**
- Calls `gmaps.directions(origin=..., destination=..., mode="walking")`
- Iterates the steps in `result[0]["legs"][0]["steps"]`
- For each step: strip HTML from `html_instructions`, use `end_location` for lat/lng
- Build Waypoint with `landmark_hint = stripped instruction text`
- Assign sequential ids, default `trigger_radius_meters=15`, default `audio_file`
- Return waypoint list

The Directions API steps use turn-by-turn text ("Turn left onto Bay St"). These become the raw `landmark_hint`. The narration Gemini call then rephrases them in sensory/accessibility language before speaking to the user — so the end experience is still landmark-based even though the source data is directional.

---

## API Key Management

`.env` file, never committed:
```
GEMINI_API_KEY=...
GOOGLE_MAPS_API_KEY=...
```

Same Maps key works for Places API, Directions API, and Static Maps API — enable all three services in Google Cloud Console on the same key.

---

## Static File Serving

```python
app.mount("/static", StaticFiles(directory="static"), name="static")
```

Frontend fetches: `http://localhost:8000/static/audio/chime.mp3`

---

## In-Memory Session and Fallback

Sessions live in a dict. If the server restarts, the frontend's localStorage copy lets it call `/session/resume` to restore. Extension path: SQLAlchemy + SQLite, router code unchanged.

---

## Error Handling

- Session not found → 404
- Gemini fails → 503 (narration failure returns `narration: null`, does not crash route)
- Places/Directions API fails → 503
- Image too large → 413
- Malformed request → 422 (auto)

---

## Running

```
cd backend
uvicorn main:app --reload --port 8000
```

Docs: http://localhost:8000/docs
