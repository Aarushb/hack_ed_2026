// clueCard.js
function createClueCard(waypoint) {
    const section = document.createElement("section");
    section.className = "clue-card";
    section.setAttribute("aria-live", "assertive");

    section.innerHTML = '
        <h2> Waypoint reached</h2>
        <p class="clue-card__hint">${waypoint?.landmark_hint ?? waypoint?.description ?? ""</p>
       ';

    return section;
}