# Northstar 🧭

**Built for HackED 2026 

An accessible, AI-powered outdoor navigation application designed to replace screen-heavy routing with intuitive, spatial audio and natural-language voice guidance. Users describe their destination naturally, and the system guides them using real-world landmarks, 3D spatial sound, and real-time visual assistance via live video streaming.

## Tech Stack
* Frontend: Vanilla JS, HTML/CSS, Web Audio API (HRTF), Web Speech API, MediaDevices (`getUserMedia`)
* Backend: Python, FastAPI, WebSockets
* AI Engine: Gemini 2.0 Flash (`gemini-2.0-flash`), Gemini Multimodal Live API
* Mapping/Routing: Google Maps JS API, Google Places API, Google Directions API, Google Static Maps API
* Geo Math: `geopy`

## Core Features
* Natural Language Processing: Search for destinations using plain language ("the big park with the fountain downtown"), resolved to real coordinates via Gemini and Google Places.
* 3D Spatial Audio (HRTF): True 3D sound positioning in the browser. Audio cues exist in physical space relative to the user's GPS and compass data.
* Voice-to-Voice AI Assistant: Powered by the Gemini Multimodal Live API. Ask for directions naturally, receive spoken landmark-based guidance ("Keep walking until you feel the pavement change texture").
* Live Video Streaming: Enable the camera for real-time visual context. The AI processes the live feed to provide immediate guidance on obstacles or surroundings, then tells you when to turn the camera off.
* Agentic Function Calling: The AI autonomously calls backend APIs (Places, Directions, Static Maps) mid-conversation if it needs to recalculate a route or verify its location.

## System Architecture

```text
Browser (Vanilla JS)
  │
  ├── Google Maps JS API ────────── map rendering (direct, no backend)
  ├── Web Audio API (HRTF) ──────── 3D spatial audio (direct, no backend)
  ├── Web Speech API ────────────── TTS fallback + voice input fallback
  ├── MediaDevices getUserMedia ──── live camera video stream
  │
  └── FastAPI Backend
          │
          ├── WebSocket /live/session ─── Gemini Multimodal Live API proxy
          │     ├── Voice-to-voice (bidirectional audio)
          │     ├── Live video frames (when camera enabled)
          │     └── Function calling (tools: map, places, directions, location)
          │
          ├── REST endpoints (session mgmt, search, narration)
          │     ├── Gemini 2.0 Flash ─── search, narration, text assistant
          │     ├── Google Places API ── resolve NLP matches to coordinates
          │     ├── Google Directions API ── auto-generate walking waypoints
          │     └── Google Static Maps API ── map tile for AI assistant context
          │
          └── Moderation service ─── content safety + jailbreak detection
```

## Setup & Deployment

### Fastest Deployment
Use Render (backend + frontend, push-to-deploy). See `docs/deploy-render.md`.

### Quick Setup (Local)

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8000
```

#### Frontend

*Note: Serve the frontend on a DIFFERENT port than the backend to avoid 501 Unsupported Method errors on `/api/*` routes.*
```bash
cd frontend
python -m http.server 5173
```
Open `http://localhost:5173` in your browser. 

*(Windows users: You can run `scripts\dev-local.cmd` to start both concurrently).*

## Documentation
Please refer to the `docs/` folder for comprehensive design documentation, detailed feature data flow, and session persistence architecture before making significant contributions.