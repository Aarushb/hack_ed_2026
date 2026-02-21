# Frontend

Built with Vanilla JS, HTML, CSS. No framework — intentional for hackathon speed.
See `docs/frontend-design.md` for full design.

## Structure

```
frontend/
├── index.html        ← Single HTML shell, scripts loaded at bottom
├── app.js            ← Entry point, global state, page routing
├── pages/            ← Full-page views (home, game, results)
├── components/       ← Reusable UI pieces (map, audio player, clue card)
├── styles/           ← CSS files
└── utils/
    ├── api.js        ← All backend fetch calls
    ├── geo.js        ← Geolocation wrappers
    └── audio.js      ← Web Audio API wrapper (positional sound)
```

## Dev Server

```
# IMPORTANT: do NOT serve the frontend on port 8000.
# Port 8000 is used by the FastAPI backend, and `python -m http.server`
# returns 501 for POST requests, which will break `/api/*` calls.

# Recommended:
python -m http.server 5173

# (Alternative)
# npx serve . -l 5173
```

Backend runs separately (from repo root):

```sh
cd backend
uvicorn main:app --reload --port 8000
```

Open: http://localhost:5173
