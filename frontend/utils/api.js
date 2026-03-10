// api.js — Centralised backend communication layer.
// Every network call goes through apiFetch(). Pages and components never
// call fetch() directly. This keeps error handling and retry logic in one place.

const API_BASE = (window.__NORTHSTAR_CONFIG__ && window.__NORTHSTAR_CONFIG__.API_BASE)
  ? window.__NORTHSTAR_CONFIG__.API_BASE
  : 'http://localhost:8000/api';

// Timeout for standard REST requests (ms)
const REQUEST_TIMEOUT_MS = 15000;

// Some endpoints (Gemini / Directions) can legitimately take longer.
const LONG_REQUEST_TIMEOUT_MS = 45000;

// HTTP status codes with user-facing meaning
const STATUS_MESSAGES = {
  400: 'Bad request — check your input.',
  404: 'Not found — the session or resource doesn\'t exist.',
  413: 'Image too large — try a smaller photo.',
  422: 'Invalid data — please check your input.',
  429: 'Rate limited — please wait a moment and try again.',
  500: 'Server error — something went wrong on our end.',
  503: 'Service unavailable — the backend or an upstream API is down.',
};

/**
 * Custom error class that carries HTTP status and structured detail
 * from the backend's JSON error response.
 */
class ApiError extends Error {
  constructor(status, detail) {
    const fallback = STATUS_MESSAGES[status] || `Unexpected error (${status})`;
    super(detail || fallback);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Core fetch wrapper. Handles JSON serialisation, timeouts, and
 * structured error extraction.
 *
 * @param {string} path   - API route, e.g. '/search/destination'
 * @param {object|null} body - POST body (null → GET request)
 * @returns {Promise<object>} Parsed JSON response
 * @throws {ApiError} on non-2xx responses
 * @throws {Error} on network failure or timeout
 */
async function apiFetch(path, body = null, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, options);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — the server took too long. Try again.');
    }
    throw new Error('Network error — could not reach the server.');
  }
  clearTimeout(timeout);

  if (!res.ok) {
    // Try to extract backend's { detail: "..." } JSON body
    let detail = null;
    try {
      const errBody = await res.json();
      detail = errBody.detail || null;
    } catch (_) { /* response wasn't JSON — use default message */ }
    throw new ApiError(res.status, detail);
  }

  return res.json();
}

// ── Typed API methods ─────────────────────────────────────────────────────
// Each method maps 1:1 to a backend endpoint. Callers get clear signatures
// and don't need to know route paths or request shapes.

/**
 * Search for destinations by natural-language query.
 * @param {string} query - e.g. "coffee shop near campus"
 * @param {number} lat - user's current latitude
 * @param {number} lng - user's current longitude
 * @returns {Promise<{candidates: Array}>}
 */
async function apiSearchDestination(query, lat, lng) {
  return apiFetch('/search/destination', { query, user_lat: lat, user_lng: lng }, LONG_REQUEST_TIMEOUT_MS);
}

/**
 * Start a new navigation session for a chosen destination.
 * @returns {Promise<{session_id, destination_name, waypoints, current_waypoint_index, tier}>}
 */
async function apiStartSession(placeId, name, destLat, destLng, userLat, userLng, tier = 'premium') {
  return apiFetch('/session/start', {
    place_id: placeId,
    destination_name: name,
    destination_lat: destLat,
    destination_lng: destLng,
    user_lat: userLat,
    user_lng: userLng,
    tier,
  }, LONG_REQUEST_TIMEOUT_MS);
}

/**
 * Get the accessible route description for TTS narration.
 * @returns {Promise<{description: string, waypoint_summary: Array}>}
 */
async function apiDescribeSession(sessionId) {
  return apiFetch('/session/describe', { session_id: sessionId }, LONG_REQUEST_TIMEOUT_MS);
}

/**
 * Resume a previously saved session.
 * @returns {Promise<{resumed: boolean, session_id: string}>}
 */
async function apiResumeSession(sessionData) {
  return apiFetch('/session/resume', {
    session_id: sessionData.sessionId,
    destination_name: sessionData.destinationName,
    waypoints: sessionData.waypoints,
    current_waypoint_index: sessionData.currentWaypointIndex,
    completed_waypoint_ids: sessionData.completedIds || [],
    tier: sessionData.tier || 'premium',
  });
}

/**
 * Send a GPS location update during active navigation.
 * @returns {Promise<{distance_meters, bearing_degrees, triggered, narration, next_waypoint, game_complete}>}
 */
async function apiUpdateLocation(sessionId, lat, lng) {
  return apiFetch('/session/update', { session_id: sessionId, lat, lng });
}

/**
 * Advance to the next waypoint after arrival trigger.
 * @returns {Promise<{next_waypoint, waypoints_remaining, narration, game_complete}>}
 */
async function apiNextWaypoint(sessionId) {
  return apiFetch('/session/next', { session_id: sessionId });
}

/**
 * Get current session state (for debugging / resume verification).
 * @returns {Promise<object>}
 */
async function apiGetSession(sessionId) {
  return apiFetch(`/session/${sessionId}`);
}

/**
 * Send a message to the AI assistant (REST-based, Basic/Standard tier).
 * @param {string} sessionId
 * @param {string} message
 * @param {string|null} imageBase64 - optional camera capture
 * @returns {Promise<{reply, needs_camera, moderation}>}
 */
async function apiAssistantMessage(sessionId, message, imageBase64 = null) {
  return apiFetch('/assistant/message', {
    session_id: sessionId,
    message,
    image_base64: imageBase64,
  }, LONG_REQUEST_TIMEOUT_MS);
}
