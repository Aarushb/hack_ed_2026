// app.js — Entry point, global state, and page routing.
// Loads after all utility, component, and page scripts.
// Manages the single shared state object and page transitions.

// ── Global application state ──────────────────────────────────────────────
// Shared across all pages and components via the `state` object.
// This is intentionally a simple mutable object — keeps the vanilla JS
// architecture straightforward without needing a state management library.

const state = {
  sessionId: null,
  destinationName: null,
  waypoints: [],
  currentWaypointIndex: 0,
  completedIds: [],
  userLocation: { lat: null, lng: null },
  userHeading: 0,       // degrees from device compass (0 = North)
  gameComplete: false,
  lastNarration: null,   // cached for "repeat" button
  tier: 'premium',       // service tier: basic | standard | premium
};

// ── Page navigation ───────────────────────────────────────────────────────

/**
 * Navigate to a page by rendering it into the #app container.
 * Clears the previous page content and scrolls to top.
 *
 * @param {Function} renderFn - page render function, e.g. renderHome, renderGame
 */
function navigateTo(renderFn) {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[app] #app container not found in DOM.');
    return;
  }

  // Stop any in-progress TTS when changing pages
  if (typeof stopSpeaking === 'function') stopSpeaking();

  // Clear page content
  app.innerHTML = '';
  window.scrollTo(0, 0);

  // Render the new page
  try {
    renderFn(app);
  } catch (err) {
    console.error('[app] Page render error:', err);
    app.innerHTML = `
      <div class="loading-overlay">
        <h2>Something went wrong</h2>
        <p>${err.message}</p>
        <button class="btn btn-primary mt-md" onclick="navigateTo(function(el) { renderHome(el, null); })">
          Go Home
        </button>
      </div>
    `;
  }
}

// ── Boot sequence ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Check for a saved session on boot
  const saved = loadSession();

  if (saved && saved.sessionId) {
    // Show home page with resume prompt
    navigateTo((el) => renderHome(el, saved));
  } else {
    // Fresh start
    navigateTo((el) => renderHome(el, null));
  }
});
