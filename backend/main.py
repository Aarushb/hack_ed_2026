# main.py - FastAPI entry point
# See docs/backend-design.md before editing

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Wayfind API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve audio files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Routers - uncomment as each is implemented
# from routers import search, session, assistant
# app.include_router(search.router, prefix="/search", tags=["search"])
# app.include_router(session.router, prefix="/session", tags=["session"])
# app.include_router(assistant.router, prefix="/assistant", tags=["assistant"])

@app.get("/")
def root():
    return {"status": "ok"}
