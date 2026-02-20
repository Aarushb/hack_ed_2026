// searchCard.js — Renders a single destination search result card.
// Each card is keyboard-focusable and click/enter-selectable for accessibility.

/**
 * Create a search result card element for a place candidate.
 *
 * @param {object}   candidate - { place_id, name, address, lat, lng, confidence }
 * @param {Function} onSelect  - called with the candidate when user picks this card
 * @returns {HTMLElement}
 */
function createSearchCard(candidate, onSelect) {
  const card = document.createElement('div');
  card.className = 'card card-clickable search-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${candidate.name}, ${candidate.address}`);

  // Confidence as a percentage string (only show if > 0)
  const confidenceText = candidate.confidence > 0
    ? `${Math.round(candidate.confidence * 100)}% match`
    : '';

  card.innerHTML = `
    <span class="search-card-icon" aria-hidden="true">📍</span>
    <div class="search-card-body">
      <h3>${_escapeHtml(candidate.name)}</h3>
      <p>${_escapeHtml(candidate.address)}</p>
    </div>
    ${confidenceText ? `<span class="search-card-confidence">${confidenceText}</span>` : ''}
  `;

  // Click handler
  card.addEventListener('click', () => onSelect(candidate));

  // Keyboard: Enter or Space selects the card
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(candidate);
    }
  });

  return card;
}

/**
 * Render a list of search result cards into a container.
 * Clears the container first. Announces result count for screen readers.
 *
 * @param {HTMLElement} container
 * @param {Array}       candidates - array of place candidates
 * @param {Function}    onSelect   - called with the chosen candidate
 */
function renderSearchResults(container, candidates, onSelect) {
  container.innerHTML = '';

  if (!candidates || candidates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-muted text-center';
    empty.textContent = 'No destinations found. Try a different search.';
    container.appendChild(empty);
    return;
  }

  // Screen reader announcement
  const srAnnounce = document.createElement('div');
  srAnnounce.className = 'sr-only';
  srAnnounce.setAttribute('aria-live', 'polite');
  srAnnounce.textContent = `${candidates.length} destination${candidates.length === 1 ? '' : 's'} found.`;
  container.appendChild(srAnnounce);

  candidates.forEach((c) => {
    container.appendChild(createSearchCard(c, onSelect));
  });
}

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * Basic HTML entity escaping to prevent XSS from backend data.
 */
function _escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
