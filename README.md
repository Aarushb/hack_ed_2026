# Project Root

## Quick Setup

**Backend**
```
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
uvicorn main:app --reload
```

**Frontend**
```
cd frontend
# Open index.html in browser, or use a simple dev server:
npx serve .
```

## Folder Overview

```
/
├── backend/          ← FastAPI app (Python)
├── frontend/         ← Vanilla JS app (HTML/CSS/JS)
├── docs/             ← All design documents
└── requirements.txt  ← Python dependencies
```

See `docs/` for full design documentation before writing any code.
