// session.js - Client-side session persistence via localStorage
// See docs/frontend-design.md, section: Session Persistence

const SESSION_KEY = "wayfind_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function saveSession(state) {
  const data = {
    sessionId: state.sessionId,
    destinationName: state.destinationName,
    waypoints: state.waypoints,
    currentWaypointIndex: state.currentWaypointIndex,
    completedIds: state.completedIds,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Could not save session to localStorage:", e);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.savedAt > SESSION_MAX_AGE_MS) {
      clearSession();
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
