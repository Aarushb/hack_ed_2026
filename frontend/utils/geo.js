// geo.js — GPS tracking, compass heading, and debounced location updates.
// Handles browser geolocation API quirks, iOS 13+ permission prompts,
// and provides a simple interface for the game loop.

// Minimum time between location updates sent to backend (ms)
const GEO_UPDATE_INTERVAL_MS = 2000;

// Minimum distance moved before sending an update (meters)
const GEO_UPDATE_MIN_DISTANCE_M = 3;

// Track when we last sent an update (for debouncing)
let _lastUpdateTime = 0;
let _lastUpdateLat = null;
let _lastUpdateLng = null;

/**
 * Get the user's current position as a one-shot request.
 * Used for the initial search query (home page) — not for continuous tracking.
 *
 * @returns {Promise<{lat: number, lng: number}>}
 * @throws {Error} with user-facing message if geolocation fails
 */
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(_geoError(err)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/**
 * Start continuous GPS tracking. Returns the watch ID so the caller
 * can stop it with `stopWatching(id)`.
 *
 * @param {Function} onUpdate - called with (lat, lng, accuracy) when position changes
 * @param {Function} onError  - called with an Error on failure
 * @returns {number} watchId
 */
function watchPosition(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError(new Error('Geolocation is not supported by your browser.'));
    return null;
  }

  return navigator.geolocation.watchPosition(
    (pos) => {
      onUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => onError(_geoError(err)),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/**
 * Stop an active geolocation watch.
 * @param {number} watchId
 */
function stopWatching(watchId) {
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Decide whether this GPS reading is worth sending to the backend.
 * Prevents spamming the server when the user hasn't moved.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function shouldSendUpdate(lat, lng) {
  const now = Date.now();

  // Always send the very first update
  if (_lastUpdateLat === null) {
    _recordUpdate(lat, lng, now);
    return true;
  }

  // Enforce minimum time interval
  if (now - _lastUpdateTime < GEO_UPDATE_INTERVAL_MS) {
    return false;
  }

  // Enforce minimum distance moved
  const dist = _haversineMeters(_lastUpdateLat, _lastUpdateLng, lat, lng);
  if (dist < GEO_UPDATE_MIN_DISTANCE_M) {
    return false;
  }

  _recordUpdate(lat, lng, now);
  return true;
}

/**
 * Reset the debounce state. Call when starting a new navigation session.
 */
function resetUpdateDebounce() {
  _lastUpdateTime = 0;
  _lastUpdateLat = null;
  _lastUpdateLng = null;
}

// ── Compass heading ───────────────────────────────────────────────────────

// Active compass listener reference (for cleanup)
let _compassListener = null;

/**
 * Start listening to device compass heading. Updates `state.userHeading`
 * directly (coupling to global state is intentional — keeps the game
 * loop simple and avoids callback indirection for a single value).
 *
 * On iOS 13+ this must be called from a user gesture — the permission
 * prompt will fail otherwise.
 *
 * @returns {Promise<boolean>} true if compass is available
 */
async function startCompass() {
  // iOS 13+ requires explicit permission request from a user gesture
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        console.warn('[geo] Compass permission denied. Heading fixed at 0°.');
        return false;
      }
    } catch (err) {
      console.warn('[geo] Compass permission error:', err.message);
      return false;
    }
  }

  // Remove any previous listener before attaching a new one
  stopCompass();

  _compassListener = (event) => {
    // `webkitCompassHeading` is Safari-specific (iOS). Falls back to
    // `event.alpha` on Android/desktop (less reliable but functional).
    if (event.webkitCompassHeading != null) {
      state.userHeading = event.webkitCompassHeading;
    } else if (event.alpha != null) {
      // Alpha goes 0-360 counterclockwise from north. Convert to compass bearing.
      state.userHeading = (360 - event.alpha) % 360;
    }
  };

  // Prefer `deviceorientationabsolute` (gives true north on Android)
  // Fall back to `deviceorientation` (iOS, or Android without absolute)
  const eventName = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute'
    : 'deviceorientation';

  window.addEventListener(eventName, _compassListener);
  return true;
}

/**
 * Stop listening to compass heading.
 */
function stopCompass() {
  if (_compassListener) {
    window.removeEventListener('deviceorientationabsolute', _compassListener);
    window.removeEventListener('deviceorientation', _compassListener);
    _compassListener = null;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────

function _recordUpdate(lat, lng, time) {
  _lastUpdateLat = lat;
  _lastUpdateLng = lng;
  _lastUpdateTime = time;
}

/**
 * Quick haversine distance in meters between two GPS points.
 * Only used for debounce threshold — doesn't need to be highly precise.
 */
function _haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = _toRad(lat2 - lat1);
  const dLng = _toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Convert browser GeolocationPositionError to a user-friendly Error.
 */
function _geoError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return new Error('Location access denied. Please enable location permissions in your browser settings.');
    case err.POSITION_UNAVAILABLE:
      return new Error('Location unavailable. Make sure GPS is enabled on your device.');
    case err.TIMEOUT:
      return new Error('Location request timed out. Try moving to an area with better signal.');
    default:
      return new Error('Could not determine your location.');
  }
}
