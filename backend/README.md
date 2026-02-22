# Backend

Built with FastAPI (Python). See `docs/backend-design.md` for full design.

## Structure

```
backend/
├── main.py           ← App entry point, CORS, router registration
├── routers/          ← One file per feature area (locations, audio, session)
├── services/         ← Business logic (geo calculations, Google API calls)
├── models/           ← Pydantic request/response schemas
└── utils/            ← Shared helpers (distance math, etc.)
```

## Running

From project root:
```
pip install -r requirements.txt
cd backend
uvicorn main:app --reload
```

API docs auto-generated at: http://localhost:8000/docs

API base path: http://localhost:8000/api

## Common local issue: 501 on /api/*
If you see `501 Unsupported method ('POST')` in a terminal running `python -m http.server`,
your frontend is being served by Python's static server on the same port as the API base.
Run the frontend on a different port (e.g. 5173) and keep the backend on 8000.
