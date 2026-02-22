// complete.js — Navigation complete screen.
// Shows a congratulations message with route stats and a button to start over.

/**
 * Render the completion page.
 *
 * @param {HTMLElement} container - the #app div
 */
function renderComplete(container) {
  container.innerHTML = '';

  const waypointCount = state.waypoints.length;
  const completedCount = state.completedIds.length;

  const page = document.createElement('div');
  page.className = 'complete-page';
  page.innerHTML = `
    <div class="trophy" aria-hidden="true">🏆</div>
    <h1>You Made It!</h1>
    <p style="color: var(--color-text); font-size: var(--font-size-lg);">
      You navigated to <strong>${_completeEscape(state.destinationName)}</strong>
    </p>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${completedCount}</div>
        <div class="stat-label">Waypoints</div>
      </div>
      <div class="stat">
        <div class="stat-value">${waypointCount}</div>
        <div class="stat-label">Total</div>
      </div>
    </div>

    <button class="btn btn-primary btn-block mt-lg" id="new-route-btn">
      Start a New Route
    </button>
  `;
  container.appendChild(page);

  // Announce completion via TTS
  speak(`Congratulations! You've reached ${state.destinationName}. ${completedCount} waypoints completed.`);

  // New route button — clear everything and go home
  page.querySelector('#new-route-btn').addEventListener('click', () => {
    stopSpeaking();
    clearSession();
    resetState();
    navigateTo((el) => renderHome(el, null));
  });
}

// ── Private helpers ───────────────────────────────────────────────────────

function _completeEscape(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
