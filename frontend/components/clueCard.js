// clueCard.js — Waypoint arrival card shown when the user reaches a waypoint.
// Displayed as an animated overlay in the game page with the waypoint name
// and description. Auto-dismissed after a timeout or on user tap.

/**
 * Show a clue card for a triggered waypoint. Inserts into the given container
 * and removes itself after a delay (or on user interaction).
 *
 * @param {HTMLElement} container - parent element to insert the card into
 * @param {object}      waypoint  - { id, name, description, landmark_hint }
 * @param {Function}    [onDismiss] - optional callback when card is dismissed
 * @param {number}      [autoHideMs=6000] - auto-dismiss delay in ms (0 to disable)
 */
function showClueCard(container, waypoint, onDismiss, autoHideMs = 6000) {
  if (!container || !waypoint) return;

  // Remove any existing clue card first
  const existing = container.querySelector('.clue-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'clue-card';
  card.setAttribute('role', 'alert');
  card.setAttribute('aria-live', 'assertive');

  card.innerHTML = `
    <h3>🎯 Waypoint Reached!</h3>
    <p style="color: var(--color-text); font-weight: 600; font-size: var(--font-size-lg); margin-bottom: var(--space-sm);">
      ${_clueEscape(waypoint.name)}
    </p>
    <p style="color: var(--color-text-muted);">
      ${_clueEscape(waypoint.description || waypoint.landmark_hint || '')}
    </p>
    <button class="btn btn-secondary mt-md" aria-label="Dismiss">Continue</button>
  `;

  // Dismiss handler
  const dismiss = () => {
    card.remove();
    if (onDismiss) onDismiss();
  };

  card.querySelector('button').addEventListener('click', dismiss);

  // Also dismiss on card tap (mobile convenience)
  card.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') dismiss();
  });

  container.appendChild(card);

  // Auto-dismiss after delay
  if (autoHideMs > 0) {
    setTimeout(() => {
      if (card.parentNode) dismiss();
    }, autoHideMs);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────

function _clueEscape(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
