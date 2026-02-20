// app.js - Entry point and global state
// See docs/frontend-design.md

const state = {
  sessionId: null,
  destinationName: null,
  waypoints: [],
  currentWaypointIndex: 0,
  completedIds: [],
  userLocation: { lat: null, lng: null },
  userHeading: 0,       // degrees from device compass (0 = North)
  gameComplete: false,
};

function navigateTo(renderFn) {
  const app = document.getElementById("app");
  app.innerHTML = "";
  renderFn(app);
}

document.addEventListener("DOMContentLoaded", () => {
  // Check for a saved session on boot
  const saved = loadSession();
  if (saved && saved.sessionId) {
    // Show resume prompt — implemented in home.js
    navigateTo((el) => renderHome(el, saved));
  } else {
    navigateTo((el) => renderHome(el, null));
  }
});
