// home.js — Destination search page.
// First screen the user sees. Text input for searching destinations,
// optional resume prompt if a previous session exists.

/**
 * Render the home page into the given container element.
 *
 * @param {HTMLElement}  container   - the #app div
 * @param {object|null}  savedSession - previously saved session from localStorage, or null
 */
function renderHome(container, savedSession) {
  container.innerHTML = '';

  // ── Resume prompt (if a saved session exists) ────────────────────────
  if (savedSession) {
    const resumeEl = document.createElement('div');
    resumeEl.className = 'resume-prompt';
    resumeEl.innerHTML = `
      <h3>Resume your route?</h3>
      <p class="text-muted">You were navigating to <strong>${_homeEscape(savedSession.destinationName)}</strong></p>
      <div class="resume-actions">
        <button class="btn btn-primary" id="resume-yes" aria-label="Resume navigation">Resume</button>
        <button class="btn btn-secondary" id="resume-no" aria-label="Start fresh">New Search</button>
      </div>
    `;
    container.appendChild(resumeEl);

    resumeEl.querySelector('#resume-yes').addEventListener('click', () => _resumeSession(savedSession));
    resumeEl.querySelector('#resume-no').addEventListener('click', () => {
      clearSession();
      renderHome(container, null); // re-render without resume prompt
    });
  }

  // ── Hero / branding ──────────────────────────────────────────────────
  const hero = document.createElement('div');
  hero.className = 'hero';
  hero.innerHTML = `
    <div class="logo" aria-hidden="true">🧭</div>
    <h1>Wayfind</h1>
    <p class="tagline">Accessible audio navigation</p>
  `;
  container.appendChild(hero);

  // ── Search form ──────────────────────────────────────────────────────
  const form = document.createElement('form');
  form.className = 'search-form';
  form.setAttribute('role', 'search');
  form.innerHTML = `
    <label for="search-input">Where do you want to go?</label>
    <div class="input-group">
      <input type="search" id="search-input" placeholder="e.g. coffee shop near campus"
             aria-label="Search destination" autocomplete="off" />
      <button type="submit" class="btn btn-primary" aria-label="Search">Search</button>
    </div>
  `;
  container.appendChild(form);

  // ── Results container ────────────────────────────────────────────────
  const resultsEl = document.createElement('div');
  resultsEl.id = 'search-results';
  resultsEl.setAttribute('aria-live', 'polite');
  container.appendChild(resultsEl);

  // ── Error banner container ───────────────────────────────────────────
  const errorEl = document.createElement('div');
  errorEl.id = 'home-error';
  container.appendChild(errorEl);

  // ── Search form submit handler ───────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = form.querySelector('#search-input').value.trim();
    if (!query) return;

    _clearHomeError();
    _showHomeLoading(resultsEl, 'Searching for destinations…');

    try {
      // Get user location for spatial context
      let userLat = 0, userLng = 0;
      try {
        const pos = await getCurrentPosition();
        userLat = pos.lat;
        userLng = pos.lng;
      } catch (geoErr) {
        // Location is optional — search still works without it, just less accurate
        console.warn('[home] Location unavailable for search:', geoErr.message);
      }

      const data = await apiSearchDestination(query, userLat, userLng);

      if (!data.candidates || data.candidates.length === 0) {
        resultsEl.innerHTML = '';
        _showHomeError('No destinations found. Try a different search.');
        return;
      }

      // Auto-select if single high-confidence result
      if (data.candidates.length === 1 && data.candidates[0].confidence > 0.85) {
        await _selectDestination(data.candidates[0], userLat, userLng);
        return;
      }

      // Render result cards
      renderSearchResults(resultsEl, data.candidates, (candidate) => {
        _selectDestination(candidate, userLat, userLng);
      });

    } catch (err) {
      resultsEl.innerHTML = '';
      _showHomeError(err.message);
    }
  });
}

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * Handle destination selection: start a new session and navigate to overview.
 */
async function _selectDestination(candidate, userLat, userLng) {
  const resultsEl = document.getElementById('search-results');
  _clearHomeError();
  _showHomeLoading(resultsEl, `Starting route to ${candidate.name}…`);

  try {
    const data = await apiStartSession(
      candidate.place_id,
      candidate.name,
      candidate.lat,
      candidate.lng,
      userLat,
      userLng,
    );

    // Populate global state
    state.sessionId = data.session_id;
    state.destinationName = data.destination_name;
    state.waypoints = data.waypoints;
    state.currentWaypointIndex = data.current_waypoint_index;
    state.completedIds = [];
    state.tier = data.tier;
    state.gameComplete = false;

    saveSession(state);
    navigateTo(renderOverview);

  } catch (err) {
    if (resultsEl) resultsEl.innerHTML = '';
    _showHomeError(`Could not start session: ${err.message}`);
  }
}

/**
 * Resume a saved session: call the backend to re-initialise, then go to game.
 */
async function _resumeSession(savedSession) {
  const errorEl = document.getElementById('home-error');
  _clearHomeError();

  try {
    const data = await apiResumeSession(savedSession);

    if (!data.resumed) {
      _showHomeError('Could not resume session. Starting fresh.');
      clearSession();
      return;
    }

    // Restore global state from saved data
    state.sessionId = savedSession.sessionId;
    state.destinationName = savedSession.destinationName;
    state.waypoints = savedSession.waypoints;
    state.currentWaypointIndex = savedSession.currentWaypointIndex;
    state.completedIds = savedSession.completedIds || [];
    state.tier = savedSession.tier || 'premium';
    state.gameComplete = false;

    navigateTo(renderGame);

  } catch (err) {
    _showHomeError(`Resume failed: ${err.message}. Try starting a new search.`);
    clearSession();
  }
}

function _showHomeLoading(el, message) {
  if (!el) return;
  el.innerHTML = `
    <div class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>${_homeEscape(message)}</p>
    </div>
  `;
}

function _showHomeError(message) {
  const el = document.getElementById('home-error');
  if (!el) return;
  el.innerHTML = `<div class="banner banner-error">⚠️ ${_homeEscape(message)}</div>`;
}

function _clearHomeError() {
  const el = document.getElementById('home-error');
  if (el) el.innerHTML = '';
}

function _homeEscape(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
