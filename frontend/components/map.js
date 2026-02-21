// map.js
function initMap(containerId = "map") {
    const el = document.getElementById(containerId);
    if (!el) return null;

    if (window.google && window.google.maps) {
        return new google.maps.Map(el, {
            center: { lat: 43.6532, lng: -79.3832 },
            zoom: 16,
            disableDefaultUI: true,
        });
    }

    el.innerHTML = "<p>Map unavailable. Audio guidance still works.</p>";
    return null;
}