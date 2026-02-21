// overview.js - accessible route summary
function renderOverview(root) {
    root.innerHTML = '
        <main class="overview-page">
            <h1>Route Overview</h1>
            <p>Destination: ${state.destinationName || "Unknown"}</p>
            
            <div>
                <button id="view-narrative-btn" type="button">Narrative</button>
                <button id="view-list-btn": type="button">Waypoint List</button>
            </div>
            
            <section id="narrative-view" aria-live="polite">
                <h2>Narrative Summary</h2>
                <p id="route-description">Loading route summary</p>
                <button id="read-summary-btn" type="button">Read Aloud</button>
                <button id="stop-summary-btn" type="button">Stop</button>
            </section>
            
            <section id="list-view" hidden>
                <h2>Waypoints</h2>
                <div id="waypoint-list-container"></div>
            </section>
            
            <button id="start-navigation-btn" type="button">Start Navigation</button>
        </main>
      ';
    
    const narrativeView = document.getElementById("narrative-view");
    const listView = document.getElementById("list-view");
    const desc = document.getElementById("route-description");
    
    document.getElementById("view-narrative-btn").addEventListener("click", () => {
        narrativeView.hidden = false;
        listView.hidden = true;
    });

    const listContainer = document.getElementById("waypoint-list-container");
    listContainer.appendChild(createWaypointList(state.waypoints, state.currentWaypointIndex));

    let summaryText = "Route summary unavailable.";
    apiFetch("/session/describe", { session_id: state.sessionId })
        .then((res) => {
            summaryText = res.description || summaryText;
            desc.textContent = summaryText;
            speak(summaryText);
        })
        .catch(() => {
            desc.textContent = summaryText;
        });
    
    document.getElementById("read-summary-btn").addEventListener("click", () => speak(summaryText));
    document.getElementById("stop-summary-btn").addEventListener("click", () => stopSpeaking());
    document.getElementById("start-navigation-btn").addEventListener("click", () => navigateTo((el) => renderGame(el)));
}