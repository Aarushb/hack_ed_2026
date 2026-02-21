// waypointList.js
function createWaypointList(waypoints = [], currentIndex = 0) {
    const ol = document.createElement("ol");
    ol.className = "waypoint-list";
    ol.setAttribute("aria-label", "Route waypoints");

    waypoints.forEach((wp, i) => {
        const li = document.createElement("li");
        li.className = "waypoint-list__item";
        if (i === currentIndex) li.setAttribute("aria-curent", "step");

        li.innerHTML = '
            <h3>${i + 1}. ${wp.name}</h3>
            <p>${wp.landmark_hint || wp.description || ""}</p>
           ';
    });

    return ol;
}