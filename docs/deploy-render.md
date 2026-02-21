# Deploy (Render) — fastest push-to-deploy workflow

This is the lowest-hassle setup for this repo:
- **Backend**: Render **Web Service** (FastAPI + WebSocket support)
- **Frontend**: Render **Static Site** (global CDN)

## 0) Prereqs
- Repo pushed to GitHub
- You have these keys ready:
  - `GEMINI_API_KEY`
  - `GOOGLE_MAPS_API_KEY`

## 1) One-click create both services (recommended)
1. Go to https://render.com/
2. New → **Blueprint**
3. Connect your GitHub repo
4. Render will detect `render.yaml` and ask for env vars:
   - Backend:
     - `GEMINI_API_KEY`
     - `GOOGLE_MAPS_API_KEY`
   - Frontend:
     - `WAYFIND_API_BASE`

If you see `unknown type "static_site"`, your Blueprint is using an older service type. This repo’s `render.yaml` uses the current format: static sites are `type: web` with `runtime: static`.

## 2) Set the link between frontend and backend
Once the backend deploys, copy its public URL:
- Example: `https://wayfind-backend.onrender.com`

Set the frontend env var:
- `WAYFIND_API_BASE` = `https://wayfind-backend.onrender.com/api`

Redeploy the frontend (Render dashboard → Manual deploy) so it rebuilds with the new value.

## 3) Verify
- Open the frontend URL and start a session.
- In DevTools → Network, confirm requests go to your Render backend URL.
- Premium Live WebSocket should connect to:
  - `wss://wayfind-backend.onrender.com/api/live/session?session_id=...`

## 4) Future updates
Just push to your repo’s deployed branch. Render auto-deploys both services.

## Local dev (still works)
- Backend: `uvicorn main:app --reload --port 8000` from `backend/`
- Frontend: `python -m http.server 5173` from `frontend/`

The frontend defaults to `http://localhost:8000/api` on localhost.
