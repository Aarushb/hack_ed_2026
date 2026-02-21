// searchCard.js
function createSearchCard(candidate, onSelect) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-card";
    btn.setAttribute("aria-label", 'Select destination ${candidate.name}');

    const confidence = Math.round((candidate.confidence ?? 0) * 100);

    btn.innerHTML = '
        <span class="search-card__name">${candidate.name}</span>
        <span class="search-card__address">${candidate.address ?? "Address unavailable"}</span>
        <span class="serach-card__confidence">Confidence ${confidence}%</span>
    ';
    
    btn.addEventListener("click", () => onSelect(candidate));
    return btn;
}