# Frontend Design Document

Vanilla JS, HTML, CSS. No framework, no build step. Read `design-overview.md` first.

---

## Why Vanilla JS

Fast to write and readable by everyone on the team regardless of experience. The component structure is intentionally similar to how React components work — if the project continues after the hackathon, migration would be straightforward without needing to rethink the architecture.

---

## Page Flow

```
Home (search)
  ↓ user picks a destination
Route Overview (accessible summary + waypoint list)
  ↓ user taps "Start"
Active Navigation (map + audio + narration + assistant)
  ↓ all waypoints complete
Complete (summary screen)
```

Each page is a JS function that renders into `#app`. Moving between pages clears and re-renders that div.

---

## Folder Structure

```
frontend/
├── index.html
├── app.js              ← global state, page routing, boot
├── pages/
│   ├── home.js         ← destination search UI
│   ├── overview.js     ← accessible route summary before starting
│   ├── game.js         ← active navigation: map, audio, assistant
│   └── complete.js     ← end screen
├── components/
│   ├── map.js          ← Google Maps wrapper
│   ├── searchCard.js   ← one result card from destination search
│   ├── waypointList.js ← accessible ordered list of waypoints
│   ├── assistant.js    ← AI chat panel (text + camera)
│   └── clueCard.js     ← card shown when a waypoint triggers
├── utils/
│   ├── api.js          ← all backend fetch calls
│   ├── geo.js          ← GPS tracking + compass
│   ├── audio.js        ← Web Audio API: spatial audio using HRTF
│   ├── speech.js       ← Web Speech API: TTS output + voice input
│   └── session.js      ← localStorage read/write for session persistence
└── styles/
    └── main.css
```

---

## Global State (app.js)

```javascript
const state = {
  sessionId: null,
  destinationName: null,
  waypoints: [],
  currentWaypointIndex: 0,
  completedIds: [],
  userLocation: { lat: null, lng: null },
  userHeading: 0,          // degrees from device compass (0 = North)
  gameComplete: false,
  lastNarration: null,     // cached for reuse when band hasn't changed
};
```

---

## Page: Home (Destination Search)

The first screen. Text input and mic button (voice input optional, nice to have).

On submit:
1. Call `apiFetch('/search/destination', { query, lat, lng })` — passing the user's current GPS coords alongside the query so the backend can give Gemini location context
2. Show a loading state
3. Render returned candidates as `searchCard` components
4. User taps a card → store selection → call `/session/start`
5. Navigate to Overview page on success

If a single candidate comes back with confidence > 0.85, auto-select it and skip the card list.

The GPS coords for the search query come from `navigator.geolocation.getCurrentPosition()` called when the user focuses or submits the search input. No need for continuous GPS tracking at this stage — a one-time fix is enough to give the AI spatial context.

Accessibility: clear input label, results announced via `aria-live="polite"`, each card keyboard-navigable and focusable.

---

## Page: Route Overview

Before walking starts. Gives users the full picture, especially important for those relying on audio.

Two views toggled by a button or tab:

Narrative view — the AI-generated route description from `/session/describe`, shown as text and auto-read via TTS on page load. Can be stopped.

List view — semantic, screen-reader-friendly ordered list:
```
1. Bay and Queen intersection — feel for the pedestrian crossing, traffic on both sides
2. Nathan Phillips Square entrance — wide ramp facing the street
```

"Start Navigation" button triggers the game loop and navigates to the Game page.

Min 18px font, high contrast. TTS starts automatically, stop button provided. List uses `<ol>` and `<li>` with proper semantic structure.

---

## Page: Game (Active Navigation)

### Layout

Top half: Google Map (visual, supplementary)
Bottom half: current waypoint info, last narration text, assistant toggle button

The map is not the primary UI — audio and voice are. The screen can be ignored entirely during navigation.

### GPS Loop

```javascript
// in game.js on page load:
geo.watchPosition(async (lat, lng) => {
  if (!shouldSendUpdate(lat, lng)) return;  // debounce: 2s or 5m moved

  const result = await apiFetch('/session/update', { session_id, lat, lng });

  audio.update(result.bearing_degrees, result.distance_meters);

  if (result.narration) {
    state.lastNarration = result.narration;
    speech.speak(result.narration);
    updateNarrationDisplay(result.narration);
  }

  updateMapMarker(lat, lng);

  if (result.triggered) {
    showClueCard(result.next_waypoint);
    speech.speak(`You've arrived at ${result.next_waypoint.name}`);
    await apiFetch('/session/next', { session_id });
  }

  if (result.game_complete) {
    navigateTo(renderComplete);
  }
});
```

`narration` from the backend is only non-null when the distance band changed. The frontend caches `lastNarration` and re-displays it on screen. It does not re-speak the same narration repeatedly.

### Compass

```javascript
// in geo.js:
window.addEventListener('deviceorientationabsolute', (e) => {
  state.userHeading = e.alpha ?? 0;
});
```

On iOS 13+, `DeviceOrientationEvent.requestPermission()` must be called from a user gesture. Show a button on game page load to prompt this — it cannot be called automatically on page load.

On desktop or if permission denied: `userHeading` defaults to 0. HRTF audio still works relative to North — it just won't rotate with the user. That's an acceptable graceful degradation.

---

## Spatial Audio — HRTF (utils/audio.js)

This is the default mode. HRTF (Head-Related Transfer Function) makes sound feel genuinely 3D — not just left/right panning, but as if the sound source exists at a point in space around you. For accessibility navigation, this is meaningfully better than stereo panning because users can localise sound in front/behind/to-the-side rather than just left vs right.

The Web Audio API's `PannerNode` with `panningModel = 'HRTF'` does this natively in the browser — no extra library needed.

### How it works

The `AudioListener` represents the user's head. It has a position (fixed at origin) and an orientation (which way the user is facing). The `PannerNode` represents the sound source — set its position in 3D space and the browser's HRTF engine calculates what it would sound like in headphones.

Coordinate system: X = east, Z = south (standard audio convention). A sound directly north of the user is at (0, 0, -1).

**Converting bearing + distance to 3D position:**

```javascript
function bearingToPosition(bearingDegrees, distanceMeters) {
  const rad = (bearingDegrees * Math.PI) / 180;
  // clamp distance so volume curve is smooth; 1–50m range works well
  const d = Math.max(1, Math.min(distanceMeters, 50));
  return {
    x: Math.sin(rad) * d,  // east-west
    y: 0,                  // same height as user
    z: -Math.cos(rad) * d  // north-south (negative = north)
  };
}
```

**Updating listener orientation from compass:**

```javascript
function updateListenerOrientation(headingDegrees) {
  const ctx = getAudioContext();
  const rad = (headingDegrees * Math.PI) / 180;
  // forward vector (which way the listener faces)
  ctx.listener.forwardX.value = Math.sin(rad);
  ctx.listener.forwardZ.value = -Math.cos(rad);
  // up vector stays fixed pointing up
  ctx.listener.upX.value = 0;
  ctx.listener.upY.value = 1;
  ctx.listener.upZ.value = 0;
}
```

**Full audio setup:**

```javascript
function setupAudio(buffer) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  const panner = ctx.createPanner();
  const gain = ctx.createGain();

  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 50;
  panner.rolloffFactor = 1;

  source.buffer = buffer;
  source.loop = true;
  source.connect(panner);
  panner.connect(gain);
  gain.connect(ctx.destination);

  gain.gain.value = 0.8;  // master volume; distance handled by PannerNode itself
  source.start();
  return { source, panner, gain };
}
```

**On each GPS update:**

```javascript
function update(bearingDegrees, distanceMeters) {
  if (!activeNodes) return;
  const pos = bearingToPosition(bearingDegrees, distanceMeters);
  activeNodes.panner.positionX.value = pos.x;
  activeNodes.panner.positionY.value = pos.y;
  activeNodes.panner.positionZ.value = pos.z;
  updateListenerOrientation(state.userHeading);
}
```

The `PannerNode` with `distanceModel = 'inverse'` handles volume falloff automatically based on the distance encoded in the position. No separate gain node for distance is needed unless you want a custom curve.

On waypoint trigger: stop the loop audio, play a "arrived" chime buffer (cached, one-shot), re-centre the panner at origin while the chime plays, then start the next waypoint's loop audio.

Pre-load all audio buffers on game page load:
```javascript
const buffers = {};
for (const wp of state.waypoints) {
  const res = await fetch(`${API_BASE}/static/audio/${wp.audio_file}`);
  buffers[wp.id] = await ctx.decodeAudioData(await res.arrayBuffer());
}
```

Important: `AudioContext` must be created (or resumed) from a user gesture. Show a "Start" button that creates the context and begins audio, so the browser doesn't block it.

Note on headphones: HRTF works best with headphones, which is exactly the use case for a navigation app. On speakers it still works but sounds less directional. No action needed — it degrades gracefully.

---

## Voice Narration (utils/speech.js)

Browser-native `SpeechSynthesis`. No cost, no library.

```javascript
function speak(text, options = {}) {
  if (!text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options.rate ?? 0.95;
  utterance.pitch = options.pitch ?? 1.0;
  utterance.lang = 'en-US';
  const voices = speechSynthesis.getVoices();
  utterance.voice =
    voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) ??
    voices.find(v => v.lang === 'en-US') ??
    voices[0];
  speechSynthesis.speak(utterance);
}
```

Called when: narration updates, waypoint triggers, assistant replies.

Voice input (nice to have — drop-in addition):
```javascript
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.onresult = (e) => sendAssistantMessage(e.results[0][0].transcript);
recognition.start();
```

---

## AI Assistant Component (components/assistant.js)

A collapsible panel on the game screen. Text input, conversation log, camera button, optional mic button.

### Sending a message

```javascript
async function sendMessage(text, imageBase64 = null) {
  const response = await apiFetch('/assistant/message', {
    session_id: state.sessionId,
    message: text,
    image_base64: imageBase64,
  });

  if (response.needs_camera) {
    // Gemini called request_camera — open camera, get image, re-send
    const imageBase64 = await captureFromCamera();
    return sendMessage(text, imageBase64);
  }

  renderMessage('assistant', response.reply);
  speech.speak(response.reply);
}
```

The `needs_camera` flag comes from the backend detecting that Gemini issued a `request_camera` function call. This is cleaner than string-matching "can I use your camera" — the model makes a structured decision to call the tool, and the frontend handles it as a typed event.

### Camera capture

On mobile — use `<input type="file" accept="image/*" capture="environment">`. This opens the camera directly and works with VoiceOver and TalkBack:

```javascript
async function captureFromCamera() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
```

On desktop — `getUserMedia` for webcam access. Same base64 conversion.

The backend compresses or rejects images that exceed Gemini's size limit and returns a 413 — the frontend should catch this and show "photo too large, try again."

---

## Session Persistence (utils/session.js)

localStorage — no server or database needed.

```javascript
const SESSION_KEY = 'wayfind_session';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    sessionId: state.sessionId,
    destinationName: state.destinationName,
    waypoints: state.waypoints,
    currentWaypointIndex: state.currentWaypointIndex,
    completedIds: state.completedIds,
    savedAt: Date.now(),
  }));
}

function loadSession() {
  try {
    const data = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!data || Date.now() - data.savedAt > MAX_AGE_MS) return null;
    return data;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
```

On boot: if a valid session exists, show "Resume your route to [destination]?" If yes, restore state and call `/session/resume` to re-initialise backend session. If no, `clearSession()` and start fresh.

`saveSession()` is called after: session start, each waypoint trigger, game complete.

---

## Google Maps Integration (components/map.js)

Loaded in `index.html` via script tag with API key.

```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_KEY&callback=initMap" async defer></script>
```

Exposes:
- `initMap(divId)` — creates map
- `setUserMarker(lat, lng)` — live position dot
- `setWaypointMarkers(waypoints)` — drops all waypoint markers
- `highlightCurrentWaypoint(id)` — visually distinguishes active target

The map is visual-only supplementary. All navigation works without it.

---

## Accessibility Considerations

- All interactive elements have ARIA labels
- New narration announced via `aria-live="polite"`
- Assistant panel is keyboard-navigable
- Route overview uses semantic `<ol>` and `<li>`
- TTS auto-plays at appropriate moments
- Camera capture via `<input capture>` — works with VoiceOver and TalkBack
- Font size minimum 18px, high contrast default colours
- No action requires looking at the screen during navigation
- HRTF audio works best with headphones — the expected use case for walking navigation

---

## API Communication

All calls go through `utils/api.js`. Never call `fetch` directly in pages or components.

```javascript
const API_BASE = 'http://localhost:8000';

async function apiFetch(path, body = null) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
```

---

## Dev Setup

```
npx serve frontend/
```

Or open `index.html` directly in Chrome. Backend must be on port 8000. Add your Google Maps API key to the script tag in `index.html` before testing the map.
