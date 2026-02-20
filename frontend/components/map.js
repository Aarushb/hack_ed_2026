// map.js — Google Maps wrapper component.
// Provides a visual-only supplementary map. All navigation works without it.
// If the Google Maps JS API isn't loaded (no API key), the map area shows
// a fallback message and everything else still functions normally.

let _map = null;
let _userMarker = null;
let _waypointMarkers = [];  // array of google.maps.Marker
let _activeWaypointId = null;

// Default map centre (used before GPS position is available)
const DEFAULT_CENTER = { lat: 53.5461, lng: -113.4938 }; // Edmonton, AB
const DEFAULT_ZOOM = 15;

/**
 * Check whether the Google Maps JS API is loaded and ready.
 * @returns {boolean}
 */
function isMapsAvailable() {
  return typeof google !== 'undefined' && typeof google.maps !== 'undefined';
}

/**
 * Initialise a Google Map inside the given container div.
 * Shows a "map unavailable" fallback if the API isn't loaded.
 *
 * @param {string} containerId - DOM id of the map container div
 * @param {object} [center]    - { lat, lng } initial centre
 * @returns {boolean} true if map was created successfully
 */
function initMap(containerId, center) {
  const container = document.getElementById(containerId);
  if (!container) return false;

  if (!isMapsAvailable()) {
    container.classList.add('map-unavailable');
    container.textContent = 'Map unavailable — add a Google Maps API key to enable.';
    return false;
  }

  _map = new google.maps.Map(container, {
    center: center || DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    disableDefaultUI: true,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    styles: _darkMapStyles(),
  });

  return true;
}

/**
 * Update (or create) the user's live position marker on the map.
 *
 * @param {number} lat
 * @param {number} lng
 */
function setUserMarker(lat, lng) {
  if (!_map) return;

  const position = { lat, lng };

  if (_userMarker) {
    _userMarker.setPosition(position);
  } else {
    _userMarker = new google.maps.Marker({
      position,
      map: _map,
      title: 'Your location',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#58a6ff',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      zIndex: 10,
    });
  }

  // Keep the map centred on the user
  _map.panTo(position);
}

/**
 * Drop markers for all waypoints on the map. Call once when the game starts.
 *
 * @param {Array} waypoints - array of { id, name, lat, lng }
 */
function setWaypointMarkers(waypoints) {
  if (!_map) return;

  // Clear existing waypoint markers
  _waypointMarkers.forEach((m) => m.setMap(null));
  _waypointMarkers = [];

  waypoints.forEach((wp, idx) => {
    const marker = new google.maps.Marker({
      position: { lat: wp.lat, lng: wp.lng },
      map: _map,
      title: wp.name,
      label: {
        text: String(idx + 1),
        color: '#0d1117',
        fontWeight: 'bold',
        fontSize: '12px',
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: '#30363d',
        fillOpacity: 1,
        strokeColor: '#8b949e',
        strokeWeight: 2,
      },
    });

    // Store the waypoint id on the marker for later highlighting
    marker._waypointId = wp.id;
    _waypointMarkers.push(marker);
  });
}

/**
 * Visually highlight the currently active waypoint marker.
 * Dims all other markers.
 *
 * @param {string} waypointId
 */
function highlightCurrentWaypoint(waypointId) {
  if (!_map) return;
  _activeWaypointId = waypointId;

  _waypointMarkers.forEach((marker) => {
    const isActive = marker._waypointId === waypointId;
    marker.setIcon({
      path: google.maps.SymbolPath.CIRCLE,
      scale: isActive ? 16 : 12,
      fillColor: isActive ? '#3fb950' : '#30363d',
      fillOpacity: 1,
      strokeColor: isActive ? '#ffffff' : '#8b949e',
      strokeWeight: 2,
    });
    marker.setZIndex(isActive ? 5 : 1);
  });
}

/**
 * Remove all markers and reset map state. Call when leaving game page.
 */
function destroyMap() {
  if (_userMarker) { _userMarker.setMap(null); _userMarker = null; }
  _waypointMarkers.forEach((m) => m.setMap(null));
  _waypointMarkers = [];
  _activeWaypointId = null;
  _map = null;
}

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * Dark colour scheme for the map tiles — matches the app's dark theme.
 */
function _darkMapStyles() {
  return [
    { elementType: 'geometry', stylers: [{ color: '#1d2c3a' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8b949e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#30363d' }],
    },
    {
      featureType: 'road',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#8b949e' }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#0d1117' }],
    },
    {
      featureType: 'poi',
      elementType: 'labels',
      stylers: [{ visibility: 'off' }],
    },
  ];
}
