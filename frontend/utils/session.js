// session.js — Client-side session persistence via localStorage.
// Saves enough state to resume navigation if the browser tab is closed
// or the page refreshes. Sessions expire after 24 hours.

const SESSION_KEY = 'wayfind_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Persist the current navigation session to localStorage.
 * Called after: session start, waypoint trigger, game complete.
 * Silently fails if storage is full or unavailable (private browsing).
 *
 * @param {object} s - the global `state` object from app.js
 */
function saveSession(s) {
  if (!s || !s.sessionId) return;

  const data = {
    sessionId: s.sessionId,
    destinationName: s.destinationName,
    waypoints: s.waypoints,
    currentWaypointIndex: s.currentWaypointIndex,
    completedIds: s.completedIds,
    tier: s.tier || 'premium',
    savedAt: Date.now(),
  };

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (err) {
    // Storage full or disabled (e.g. Safari private browsing).
    // Non-critical — the app works without persistence.
    console.warn('[session] Could not save to localStorage:', err.message);
  }
}

/**
 * Load a previously saved session from localStorage.
 * Returns null if no session exists, data is corrupt, or it has expired.
 *
 * @returns {object|null} Saved session data or null
 */
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);

    // Validate required fields exist
    if (!data.sessionId || !data.destinationName || !Array.isArray(data.waypoints)) {
      clearSession();
      return null;
    }

    // Check expiry
    if (Date.now() - data.savedAt > SESSION_MAX_AGE_MS) {
      clearSession();
      return null;
    }

    return data;
  } catch (err) {
    // Corrupt JSON or unexpected structure
    console.warn('[session] Failed to load saved session:', err.message);
    clearSession();
    return null;
  }
}

/**
 * Remove the saved session. Called on game complete or when user
 * declines to resume.
 */
function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) { /* ignore removal failures */ }
}
