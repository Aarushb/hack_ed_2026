// config.js — runtime configuration (no build tooling required)
// Vercel build step will overwrite this file in the deploy output.

window.__WAYFIND_CONFIG__ = window.__WAYFIND_CONFIG__ || {};

// Local dev default (backend: http://localhost:8000/api)
if (!window.__WAYFIND_CONFIG__.API_BASE) {
  window.__WAYFIND_CONFIG__.API_BASE = 'http://localhost:8000/api';
}
