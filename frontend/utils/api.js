// api.js - All backend calls go through here
// See docs/frontend-design.md and docs/api-endpoints.md

const API_BASE = 'http://localhost:8000';

async function apiFetch(path, body = null) {
  const options = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
