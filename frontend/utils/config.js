// config.js — runtime configuration (no build tooling required)

window.__NORTHSTAR_CONFIG__ = window.__NORTHSTAR_CONFIG__ || {};

if (!window.__NORTHSTAR_CONFIG__.API_BASE) {
  // Use relative path — nginx will proxy /api to the backend.
  // This works for any domain (localhost, production server, etc.)
  window.__NORTHSTAR_CONFIG__.API_BASE = "/api";
}

// Keep empty by default. Set this at runtime from a non-committed source.
if (!window.__NORTHSTAR_CONFIG__.GOOGLE_MAPS_API_KEY) {
  window.__NORTHSTAR_CONFIG__.GOOGLE_MAPS_API_KEY = "";
}
