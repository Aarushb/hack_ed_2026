# Deploy (Vercel) — hackathon guide

This repo is a vanilla JS static frontend (`frontend/`) + a FastAPI backend (`backend/`).

## Important limitation (WebSockets)
Vercel serverless functions do **not** support long-lived WebSockets reliably. Your Premium **live** mode (`/api/live/session` WebSocket) needs a backend host that supports WebSockets (Render/Fly/etc.).

Recommended hackathon setup:
- **Frontend** on Vercel (free tier)
- **Backend** on a WebSocket-capable host (Render free tier works for a few days)

---

## 1) Put the repo on GitHub
1. Create a GitHub repo.
2. Push this repo (including `frontend/` + `backend/`).

---

## 2) Deploy the backend (WebSocket-capable)
### Option A: Render (easy)
1. Go to https://render.com and create an account.
2. New → **Web Service** → connect your GitHub repo.
3. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables (Render dashboard → Environment):
   - `GEMINI_API_KEY` (required)
   - `GOOGLE_MAPS_API_KEY` (required)
   - `GEMINI_MODEL` (optional)
5. Deploy.
6. Copy your backend URL, e.g. `https://northstar-backend.onrender.com`
   - Your API base becomes: `https://northstar-backend.onrender.com/api`

---

## 3) Deploy the frontend (Vercel)
Vercel deploys the app as a static site and injects the backend URL at build time.

### From the Vercel UI (recommended)
1. Go to https://vercel.com and sign up.
2. New Project → import your GitHub repo.
3. Project settings:
   - **Framework Preset**: Other
   - **Build Command**: `npm run build:vercel`
   - **Output Directory**: `dist`
4. Environment Variables (Project → Settings → Environment Variables):
   - `NORTHSTAR_API_BASE` = `https://YOUR_BACKEND_HOST/api`
5. Deploy.

### If your backend is also on Vercel
You can still link Basic/Standard REST endpoints the same way:
- Set `NORTHSTAR_API_BASE` in the **frontend** project to your **backend** project URL + `/api`
   - Example: `https://northstar-backend.vercel.app/api`

Note: Premium Live (`/api/live/session` WebSocket) will likely fail on a Vercel-hosted backend due to the WebSocket limitation above.

### From your terminal (optional)
Install Node.js + npm, then run:

```powershell
cd d:\PROGRAMMING\projects\hackathons\hacked26\hack_ed_2026
npm install -g vercel
npm install
$env:NORTHSTAR_API_BASE="https://YOUR_BACKEND_HOST/api"
npm run deploy:vercel
```

Or run the helper script:

```powershell
cd d:\PROGRAMMING\projects\hackathons\hacked26\hack_ed_2026
.\scripts\deploy-frontend-vercel.ps1 -ApiBase "https://YOUR_BACKEND_HOST/api"
```

---

## 4) Verify
1. Open the Vercel URL.
2. Start a session; confirm requests go to your backend host (DevTools → Network).
3. Premium live mode should connect via WebSocket to:
   - `wss://YOUR_BACKEND_HOST/api/live/session?session_id=...`

---

## Troubleshooting
- **CORS errors**: the backend is permissive by default (`allow_origins=["*"]`), so this usually means the frontend is still pointing at localhost. Re-check `NORTHSTAR_API_BASE` in Vercel.
- **Backend sleeps** (free tier): first request after idle may be slow.
- **WebSocket fails on Vercel backend**: expected limitation — deploy backend to Render/Fly instead.
