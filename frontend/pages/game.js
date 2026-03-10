// game.js — Active navigation page.
// Core game loop: GPS tracking → backend update → audio repositioning →
// narration → waypoint triggers → completion. Manages the map, HRTF audio,
// compass, assistant panel, and all real-time navigation state.

// Module-level references for cleanup on page teardown
let _geoWatchId = null;
let _isProcessingUpdate = false;  // prevents overlapping backend calls

/**
 * Render the active navigation game page.
 *
 * @param {HTMLElement} container - the #app div
 */
function renderGame(container) {
  container.innerHTML = '';

  const currentWp = state.waypoints[state.currentWaypointIndex];

  // ── Page layout ──────────────────────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'game-layout';
  layout.innerHTML = `
    <div class="map-container" id="game-map" aria-label="Navigation map"></div>

    <div class="game-info">
      <div class="game-status">
        <div class="waypoint-progress">
          Waypoint ${state.currentWaypointIndex + 1} of ${state.waypoints.length}
        </div>
        <div class="distance-display" id="distance-display">Locating…</div>
        <div class="text-muted" id="current-waypoint-name">
          ${currentWp ? _gameEscape(currentWp.name) : 'No waypoint'}
        </div>
      </div>

      <div class="narration-box" aria-live="polite" aria-label="Navigation narration">
        <p id="narration-text">${state.lastNarration ? _gameEscape(state.lastNarration) : 'Narration will appear here…'}</p>
      </div>

      <div id="clue-card-container" aria-live="assertive"></div>
    </div>
    
    <div class="fab-container">
      <button class="btn btn-fab btn-fab-secondary" id="repeat-narration" aria-label="Repeat last narration" title="Repeat last instruction">
        🔊
      </button>
      <button class="btn btn-fab btn-fab-primary" id="assistant-toggle" aria-label="Open AI assistant" title="NorthStar Assistant">
        <img src="assets/logo.webp" alt="" class="fab-logo" />
      </button>
    </div>
    <button class="btn btn-danger" id="end-nav" aria-label="End navigation" style="position:fixed; top:12px; right:12px; z-index:99; font-weight:bold; padding:8px 16px;">
      End
    </button>
  `;
  container.appendChild(layout);

  // ── Error banner (shown for geo/network issues) ──────────────────────
  const errorBanner = document.createElement('div');
  errorBanner.id = 'game-error';
  layout.querySelector('.game-info').prepend(errorBanner);

  // ── Mount the assistant panel ────────────────────────────────────────
  mountAssistant(container);

  // ── Wire up buttons ──────────────────────────────────────────────────
  document.getElementById('assistant-toggle').addEventListener('click', toggleAssistant);

  document.getElementById('repeat-narration').addEventListener('click', () => {
    if (state.lastNarration) {
      speak(state.lastNarration);
    } else {
      speak('No narration available yet.');
    }
  });

  document.getElementById('end-nav').addEventListener('click', () => {
    _teardownGame();
    clearSession();
    resetState();
    navigateTo((el) => renderHome(el, null));
  });

  // ── Initialise systems (must be called from user gesture context) ────
  _initGameSystems();
}

// ── Game initialisation ───────────────────────────────────────────────────

/**
 * Start all game subsystems: map, audio, compass, GPS, live session.
 * Wrapped in a function so it's easy to reason about startup order.
 */
async function _initGameSystems() {
  const currentWp = state.waypoints[state.currentWaypointIndex];

  // 1. Initialise map (non-blocking — map is supplementary)
  const mapReady = initMap('game-map', currentWp ? { lat: currentWp.lat, lng: currentWp.lng } : null);
  if (mapReady) {
    setWaypointMarkers(state.waypoints);
    if (currentWp) highlightCurrentWaypoint(currentWp.id);
  }

  // 2. Resume audio context (needs prior user gesture — "Start Navigation" button counts)
  try {
    await resumeContext();
  } catch (_) {
    console.warn('[game] AudioContext resume failed — audio may not play.');
  }

  // 3. Preload audio buffers for all waypoints
  try {
    await preloadBuffers(state.waypoints);
    if (currentWp) startWaypointAudio(currentWp.id);
  } catch (err) {
    console.warn('[game] Audio preload error:', err.message);
  }

  // 4. Start compass
  try {
    await startCompass();
  } catch (_) {
    // Compass unavailable — heading stays at 0°, HRTF still works relative to north
  }

  // 5. Reset geo debounce for fresh session
  resetUpdateDebounce();

  // 6. Start GPS tracking
  _geoWatchId = watchPosition(
    (lat, lng, accuracy) => _onLocationUpdate(lat, lng, accuracy),
    (err) => _showGameError(err.message),
  );

  // 7. Connect live WebSocket for Premium tier (restore initial connection)
  if (state.tier === 'premium' && state.sessionId) {
    connectLiveSession(state.sessionId);
  }
}

// ── GPS update handler ────────────────────────────────────────────────────

/**
 * Handle each GPS position update. Debounces, sends to backend,
 * processes the response (audio, narration, waypoint triggers, completion).
 */
async function _onLocationUpdate(lat, lng, accuracy) {
  // Update global state with latest position
  state.userLocation.lat = lat;
  state.userLocation.lng = lng;

  // Update map marker (always, even if we skip the backend call)
  setUserMarker(lat, lng);

  // Send location to live session if connected
  sendLiveLocation(lat, lng);

  // Debounce: skip if too soon or hasn't moved enough
  if (!shouldSendUpdate(lat, lng)) return;

  // Prevent overlapping backend calls
  if (_isProcessingUpdate) return;
  _isProcessingUpdate = true;

  try {
    const result = await apiUpdateLocation(state.sessionId, lat, lng);

    // Update distance display
    const distEl = document.getElementById('distance-display');
    if (distEl) {
      const distText = result.distance_meters < 1000
        ? `${Math.round(result.distance_meters)} m`
        : `${(result.distance_meters / 1000).toFixed(1)} km`;
      distEl.textContent = distText;
    }

    // Reposition HRTF audio cue
    updateAudioPosition(result.bearing_degrees, result.distance_meters);

    // Speak new narration (only when distance band changes)
    if (result.narration) {
      state.lastNarration = result.narration;
      _updateNarrationDisplay(result.narration);
      speak(result.narration);
    }

    // Handle waypoint arrival trigger
    if (result.triggered) {
      await _handleWaypointTrigger(result);
    }

    // Handle game completion
    if (result.game_complete) {
      _teardownGame();
      state.gameComplete = true;
      saveSession(state);
      navigateTo(renderComplete);
      return;
    }

    _clearGameError();

  } catch (err) {
    // Network errors during navigation are non-fatal — show banner but keep tracking
    _showGameError(`Update error: ${err.message}`);
  } finally {
    _isProcessingUpdate = false;
  }
}

// ── Waypoint trigger handling ─────────────────────────────────────────────

async function _handleWaypointTrigger(result) {
  const triggeredWp = state.waypoints[state.currentWaypointIndex];

  // Play arrival chime and stop directional audio
  stopAudio();
  playArrivalChime();

  // Mark this waypoint as completed
  if (triggeredWp && !state.completedIds.includes(triggeredWp.id)) {
    state.completedIds.push(triggeredWp.id);
  }

  // Show the clue card
  const clueContainer = document.getElementById('clue-card-container');
  if (clueContainer && triggeredWp) {
    showClueCard(clueContainer, triggeredWp);
    speak(`You've arrived at ${triggeredWp.name}.`);
  }

  // Advance to next waypoint via backend
  try {
    const nextData = await apiNextWaypoint(state.sessionId);

    if (nextData.game_complete) {
      _teardownGame();
      state.gameComplete = true;
      saveSession(state);
      navigateTo(renderComplete);
      return;
    }

    // Update state to next waypoint
    state.currentWaypointIndex++;
    const nextWp = state.waypoints[state.currentWaypointIndex];

    // Update UI
    _updateStatusDisplay();
    if (nextWp) highlightCurrentWaypoint(nextWp.id);

    // Start audio for next waypoint after a short delay (let chime finish)
    if (nextWp) {
      setTimeout(() => startWaypointAudio(nextWp.id), 1500);
    }

    // Speak transition narration
    if (nextData.narration) {
      state.lastNarration = nextData.narration;
      _updateNarrationDisplay(nextData.narration);
      setTimeout(() => speak(nextData.narration), 2000);
    }

    saveSession(state);

  } catch (err) {
    _showGameError(`Could not advance waypoint: ${err.message}`);
  }
}

// ── UI update helpers ─────────────────────────────────────────────────────

function _updateNarrationDisplay(text) {
  const el = document.getElementById('narration-text');
  if (el) el.textContent = text;
}

function _updateStatusDisplay() {
  const currentWp = state.waypoints[state.currentWaypointIndex];

  const progressEl = document.querySelector('.waypoint-progress');
  if (progressEl) {
    progressEl.textContent = `Waypoint ${state.currentWaypointIndex + 1} of ${state.waypoints.length}`;
  }

  const nameEl = document.getElementById('current-waypoint-name');
  if (nameEl && currentWp) {
    nameEl.textContent = currentWp.name;
  }
}

function _showGameError(message) {
  const el = document.getElementById('game-error');
  if (!el) return;
  el.innerHTML = `<div class="banner banner-warning">⚠️ ${_gameEscape(message)}</div>`;
}

function _clearGameError() {
  const el = document.getElementById('game-error');
  if (el) el.innerHTML = '';
}

// ── Cleanup ───────────────────────────────────────────────────────────────

/**
 * Stop all game subsystems. Called when leaving the page or ending navigation.
 */
function _teardownGame() {
  // Stop GPS tracking
  if (_geoWatchId != null) {
    stopWatching(_geoWatchId);
    _geoWatchId = null;
  }

  // Stop audio
  stopAudio();
  destroyAudio();

  // Stop compass
  stopCompass();

  // Stop TTS
  stopSpeaking();

  // Unmount assistant (also disconnects live WebSocket)
  unmountAssistant();

  // Destroy map
  destroyMap();

  _isProcessingUpdate = false;
}

function _gameEscape(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
