// game.js - active navigation
function renderGame(root) {
    root.innerHTML = '
        <main class="game-page">
            <h1>Active Navigation</h1>
            
            <section>
                <h2>Map</h2>
                <div id="map" style="height: 280px;"></div>
            </section>
            
            <section aria-live="polite">
                <h2>Current Waypoint</h2>
                <p id="current-waypoint-name">Loading...</p>
                <p id="last-narration">Waiting for guidance...</p>
            </section>
            
            <section id="clue-card-host"></section>
            <section id="assistant-host"></section>
            
            <div>
                <button id="enable-audio-btn" type="button">Enable Audio</button>
                <button id="complete-route-btn" type="button">End Route</button>
            </div>
        </main>
      ';
    
    initMap("map");

    const current = state.waypoints[state.currentWaypointIndex];
    document.getElementById("current-waypoint-name").textContent = 
        current ? current.name : "No active waypoint";

    const assistantHost = document.getElementById("assistant-host");
    assistantHost.appendChild(createAssistantPanel());

    document.getElementById("enable-audio-btn").addEventListener("click", () => {
        resumeContext();
    });

    document.getElementById("complete-route-btn").addEventListener("click", () => {
        state.gameComplete = true;
        clearSession();
        navigateTo((el) => renderComplete(el));
    });

    // Basic GPS update loop for UI wiring
    watchPosition(async (pos) => {
        try {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            const updateRes = await apiFetch("/session/update", {
                session_id: state.sessionId,
                lat,
                lng,
            });

            if (updateRes.narration) {
                document.getElementById("last-narration").textContent = updateRes.narration;
                speak(updateRes.narration);
            }

            if (updateRes.triggered && updateRes.next_waypoint) {
                document.getElementById("clue-card'host").innerHTML = "";
                document.getElementById("clue-card-host").appendChild(createClueCard(updateRes.next_waypoint));
            }

            if (updateRes.game_complete) {
                clearSession();
                navigateTo((el) => renderComplete(el));
            }
        } catch (err) {
            document.getElementById("last-narration").textContent = 'Update error: ${err.message}';
        }
    });
}