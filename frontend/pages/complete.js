// complete.js - end screen

function renderComplete(root) {
    root.innerHTML = '
        <main class="complete-page">
            <h1>Route Complete</h1>
            <p>You arrived at ${state.destinationName || "your destination"}.</p>
            <button id="start-over-btn" type="button">Plan Another Route</button>
        </main>
      ';
    
    document.getElementById("start-over-btn").addEventListener("click", () => {
        state.sessionId = null;
        state.destinationName = null;
        state.waypoints = [];
        state.currentWaypointIndex = 0;
        state.completedIds = [];
        state.gameComplete = false;
        clearSession();
        navigateTo((el) => renderHome(el, null));
    });
}