// config.js — runtime configuration (no build tooling required)

window.__WAYFIND_CONFIG__ = window.__WAYFIND_CONFIG__ || {};

const host = String((window.location && window.location.hostname) || "").toLowerCase();
const isLocal = host === "localhost" || host === "127.0.0.1";

if (!window.__WAYFIND_CONFIG__.API_BASE) {
  // Local backend + deployed Render backend.
  window.__WAYFIND_CONFIG__.API_BASE = isLocal
    ? "http://127.0.0.1:8000/api"
    : "https://wayfind-backend.onrender.com/api";
}

// Keep empty by default. Set this at runtime from a non-committed source.
if (!window.__WAYFIND_CONFIG__.GOOGLE_MAPS_API_KEY) {
  window.__WAYFIND_CONFIG__.GOOGLE_MAPS_API_KEY = "";
}
