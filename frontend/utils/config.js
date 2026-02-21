// config.js — runtime configuration (no build tooling required)
// Vercel build step will overwrite this file in the deploy output.

window.__WAYFIND_CONFIG__ = window.__WAYFIND_CONFIG__ || {};

if (!window.__WAYFIND_CONFIG__.API_BASE) {
  const host = String(window.location && window.location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  // Local dev default (backend: http://localhost:8000/api)
  // Production default: same-origin '/api' (works if you proxy/rewrite /api).
  window.__WAYFIND_CONFIG__.API_BASE = isLocal
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;
}
