import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import model  # noqa: F401  (registers all SQLAlchemy models)
from database import Base, engine
from routers import admissions, auth, contact, content, dashboard, management, settings

# Create any missing tables in Supabase on startup
Base.metadata.create_all(bind=engine)

# Set ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com in
# backend/.env for production. Defaults to "*" for local development.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
]

app = FastAPI(
    title="TSA International School, Rawatsar API",
    description="Backend API for the school website and admin panel",
    version="2.0.0",
)

# Bearer tokens are used (not cookies), so a permissive origin policy is safe
# for local development. Restrict this to your real domain in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admissions.router)
app.include_router(contact.router)
app.include_router(content.public)
app.include_router(content.admin)
app.include_router(dashboard.router)
app.include_router(management.router)
app.include_router(settings.public)
app.include_router(settings.admin)


@app.get("/api/health")
@app.get("/health")
def health_check():
    return {"status": "healthy"}


# Serve the whole website (including /admin) from the same backend, so the
# site runs on a single address: http://127.0.0.1:8000
FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "frontend"
)

if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
