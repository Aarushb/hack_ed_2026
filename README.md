# Project Root

## Quick Setup

**Backend**
```
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend**
```
cd frontend
# Serve the frontend on a DIFFERENT port than the backend.
# If you run `python -m http.server` on port 8000, POST requests to `/api/*`
# will hit the static server and return 501 (Unsupported method).
python -m http.server 5173
```

Open: http://localhost:5173

Tip: on Windows you can run `scripts\dev-local.cmd` to start both.

## Folder Overview

```
/
├── backend/          ← FastAPI app (Python)
├── frontend/         ← Vanilla JS app (HTML/CSS/JS)
├── docs/             ← All design documents
└── requirements.txt  ← Python dependencies
```

See `docs/` for full design documentation before writing any code.
