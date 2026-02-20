// waypointList.js — Accessible ordered list of waypoints.
// Uses semantic <ol>/<li> for screen reader compatibility.
// Visually indicates completed, active, and upcoming waypoints.

/**
 * Render the waypoint list into a container element.
 * Each waypoint gets a numbered step with its name and landmark hint.
 *
 * @param {HTMLElement} container          - parent element to render into
 * @param {Array}       waypoints          - array of waypoint objects
 * @param {number}      currentIndex       - index of the current target waypoint
 * @param {Array}       completedIds       - array of completed waypoint id strings
 */
function renderWaypointList(container, waypoints, currentIndex, completedIds) {
  container.innerHTML = '';

  if (!waypoints || waypoints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-muted';
    empty.textContent = 'No waypoints available.';
    container.appendChild(empty);
    return;
  }

  const ol = document.createElement('ol');
  ol.className = 'waypoint-list';
  ol.setAttribute('aria-label', 'Route waypoints');

  waypoints.forEach((wp, idx) => {
    const li = document.createElement('li');

    // Determine state for styling
    const isCompleted = completedIds.includes(wp.id);
    const isActive = idx === currentIndex && !isCompleted;

    if (isCompleted) li.classList.add('waypoint-completed');
    if (isActive) li.classList.add('waypoint-active');

    // Accessibility: announce state
    const stateLabel = isCompleted ? ' (completed)' : isActive ? ' (current)' : '';
    li.setAttribute('aria-label', `Waypoint ${idx + 1}: ${wp.name}${stateLabel}`);

    // Waypoint name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'waypoint-name';
    nameSpan.textContent = wp.name;
    li.appendChild(nameSpan);

    // Landmark hint (if available)
    if (wp.landmark_hint || wp.description) {
      const hint = document.createElement('div');
      hint.className = 'waypoint-hint';
      hint.textContent = wp.landmark_hint || wp.description;
      li.appendChild(hint);
    }

    ol.appendChild(li);
  });

  container.appendChild(ol);
}
