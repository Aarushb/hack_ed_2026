// home.js - destination search + resume prompt
function renderHome(root, savedSession = null) {
    root.innerHTML = `
        <main class="home-page">
            <h1>North Star</h1>
            <p>Describe where you want to go.</p>
            
            ${
                savedSession
                    ? `section class="resume-card">
                        <h2>Resume route?</h2>
                        <p>Continue to ${savedSession.destinationName || "your destination"}.</p>
                        <button id="resume-btn" type="button">Resume</button>
                        <button id="new-route-btn" type="button">Start New Route</button>
                       </section>`
                    : ""
            }

            <form id="search-form" aria-label="Destination search">
                <label for="destination-input">Destination</label>
                <input id="destination-input" name="destination" type="text" required />
                <button type="submit">Search</button>
            </form>

            <section>
                <h2>Results</h2>
                <div id="search-results" aria-live="polite"></div>
            </section>
        </main>`;
    
    const resumeBtn = document.getElementById("resume-btn");
    const newRouteBtn = document.getElementById("new-route-btn");

    if (resumeBtn) {
        resumeBtn.addEventListener("click", () => {
            state.sessionId = savedSession.sessionId;
            state.destinationName = savedSession.destinationName;
            state.waypoints = savedSession.waypoints || [];
            state.currentWaypointIndex = savedSession.currentWaypointIndex || 0;
            state.completedIds = savedSession.completedIds || [];
            navigateTo((el) => renderOverview(el));
        });
    }

    if (newRouteBtn) {
        newRouteBtn.addEventListener("click", () => {
            clearSession();
            navigateTo((el) => renderHome(el, null));
        });
    }

    const form = document.getElementById("search-form");
    const results = document.getElementById("search-results");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = document.getElementById("destination-input").value.trim();
        if (!query) return;

        results.innerHTML = "<p>Searching...</p>";

        try {
            const pos = await getCurrentPosition();
            const body = {
                query,
                user_lat: pos.coords.latitude,
                user_lng: pos.coords.longitude,
            };

            const res = await apiFetch("/search/destination", body);
            const candidates = res.candidates || [];

            results.innerHTML = "";
            if (!candidates.length) {
                results.innerHTML = "<p>No matches found.</p>";
                return;
            }

            candidates.forEach((candidate) => {
                results.appendChild(
                    createSearchCard(candidate, async (selected) => {
                        const start = await apiFetch("/session/start", {
                            place_id: selected.place_id,
                            destination_name: selected.name,
                            destination_lat: selected.lat,
                            destination_lng: selected.lng,
                            user_lat: pos.coords.latitude,
                            user_lng: pos.coords.longitude,
                            tier: "premium",
                        });

                        state.sessionId = start.session_id;
                        state.destinationName = start.destination_name;
                        state.waypoints = start.waypoints || [];
                        state.currentWaypointIndex = start.current_waypoint_index || 0;
                        saveSession(state);
                        navigateTo((el) => renderOverview(el));
                    })
                );
            });
        } catch (err) {
            results.innerHTML = `<p>Search failed: ${err.message}</p>`;
        }
    });
}