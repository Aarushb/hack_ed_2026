// overview.js — Route overview page.
// Shows the AI-generated accessible route description and a structured
// waypoint list before the user starts navigation. TTS reads the
// description automatically. Two tabs: Narrative and List view.

/**
 * Render the route overview page.
 * Fetches the route description from the backend and displays it.
 *
 * @param {HTMLElement} container - the #app div
 */
function renderOverview(container) {
  container.innerHTML = '';

  // ── Header ───────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.innerHTML = `
    <h2>Route to ${_overviewEscape(state.destinationName)}</h2>
    <p class="text-muted">${state.waypoints.length} waypoint${state.waypoints.length === 1 ? '' : 's'}</p>
  `;
  container.appendChild(header);

  // ── Tab bar ──────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  tabBar.setAttribute('role', 'tablist');
  tabBar.innerHTML = `
    <button class="tab-btn active" data-tab="narrative" role="tab" aria-selected="true">Narrative</button>
    <button class="tab-btn" data-tab="list" role="tab" aria-selected="false">Waypoint List</button>
  `;
  container.appendChild(tabBar);

  // ── Tab panels ───────────────────────────────────────────────────────
  const narrativePanel = document.createElement('div');
  narrativePanel.id = 'tab-narrative';
  narrativePanel.setAttribute('role', 'tabpanel');
  narrativePanel.innerHTML = `
    <div class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>Generating route description…</p>
    </div>
  `;
  container.appendChild(narrativePanel);

  const listPanel = document.createElement('div');
  listPanel.id = 'tab-list';
  listPanel.className = 'hidden';
  listPanel.setAttribute('role', 'tabpanel');
  container.appendChild(listPanel);

  // Render the waypoint list immediately (no async needed)
  renderWaypointList(listPanel, state.waypoints, state.currentWaypointIndex, state.completedIds);

  // ── Tab switching ────────────────────────────────────────────────────
  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;

    const tab = btn.dataset.tab;
    tabBar.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    narrativePanel.classList.toggle('hidden', tab !== 'narrative');
    listPanel.classList.toggle('hidden', tab !== 'list');
  });

  // ── Action buttons ───────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'mt-lg';
  actions.innerHTML = `
    <button class="btn btn-primary btn-block" id="start-nav-btn" disabled>
      Start Navigation
    </button>
    <button class="btn btn-secondary btn-block mt-sm" id="stop-tts-btn">
      Stop Reading
    </button>
    <button class="btn btn-danger btn-block mt-sm" id="cancel-route-btn">
      Cancel Route
    </button>
  `;
  container.appendChild(actions);

  const startBtn = actions.querySelector('#start-nav-btn');
  const stopTtsBtn = actions.querySelector('#stop-tts-btn');
  const cancelBtn = actions.querySelector('#cancel-route-btn');

  stopTtsBtn.addEventListener('click', () => stopSpeaking());

  cancelBtn.addEventListener('click', () => {
    stopSpeaking();
    clearSession();
    _resetState();
    navigateTo((el) => renderHome(el, null));
  });

  startBtn.addEventListener('click', () => {
    stopSpeaking();
    navigateTo(renderGame);
  });

  // ── Fetch route description from backend ─────────────────────────────
  _loadDescription(narrativePanel, startBtn);
}

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * Fetch the route description and render it. Auto-reads via TTS.
 */
async function _loadDescription(panel, startBtn) {
  try {
    const data = await apiDescribeSession(state.sessionId);

    // Render description text
    panel.innerHTML = '';
    const descEl = document.createElement('div');
    descEl.className = 'card';
    descEl.innerHTML = `<p style="color: var(--color-text); margin: 0;">${_overviewEscape(data.description)}</p>`;
    panel.appendChild(descEl);

    // If backend returns a waypoint summary, show it beneath the narrative
    if (data.waypoint_summary && data.waypoint_summary.length > 0) {
      const summaryList = document.createElement('div');
      summaryList.className = 'mt-md';
      data.waypoint_summary.forEach((wp, idx) => {
        const item = document.createElement('p');
        item.className = 'text-muted';
        item.textContent = `${idx + 1}. ${wp.name || wp.description || ''}`;
        summaryList.appendChild(item);
      });
      panel.appendChild(summaryList);
    }

    // Enable the start button now that the description is loaded
    startBtn.disabled = false;

    // Auto-read the description via TTS
    speak(data.description);

  } catch (err) {
    panel.innerHTML = `
      <div class="banner banner-error">
        ⚠️ Could not load route description: ${_overviewEscape(err.message)}
      </div>
      <p class="text-muted">You can still start navigation — the description is optional.</p>
    `;
    // Allow starting even if description fails
    startBtn.disabled = false;
  }
}

/**
 * Reset global state to defaults. Used when cancelling a route.
 */
function _resetState() {
  state.sessionId = null;
  state.destinationName = null;
  state.waypoints = [];
  state.currentWaypointIndex = 0;
  state.completedIds = [];
  state.gameComplete = false;
  state.lastNarration = null;
}

function _overviewEscape(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
