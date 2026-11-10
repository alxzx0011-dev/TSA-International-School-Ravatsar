import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as DatabaseTimeoutError

import model  # noqa: F401  (registers all SQLAlchemy models)
from database import init_db
from routers import (
    admissions,
    auth,
    contact,
    content,
    dashboard,
    features,
    management,
    portals,
    settings,
    users,
)

# Create any missing tables in Supabase on startup
init_db()

# Set ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com in
# backend/.env for production. Defaults to "*" for local development.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
]

app = FastAPI(
    title="TSA International School, Rawatsar, Rajasthan API",
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

# Compress JSON/HTML responses so slow mobile connections load faster.
app.add_middleware(GZipMiddleware, minimum_size=500)


@app.middleware("http")
async def cache_static_assets(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path

    if path.startswith("/assets/") or path.endswith(
        (".css", ".js", ".jpg", ".jpeg", ".png", ".svg", ".webp", ".ico", ".woff2")
    ):
        response.headers["Cache-Control"] = "public, max-age=600"

    return response

app.include_router(auth.router)
app.include_router(admissions.router)
app.include_router(contact.router)
app.include_router(content.public)
app.include_router(content.admin)
app.include_router(dashboard.router)
app.include_router(management.router)
app.include_router(features.router)
app.include_router(portals.parent)
app.include_router(portals.teacher)
app.include_router(users.router)
app.include_router(settings.public)
app.include_router(settings.admin)


@app.get("/api/health")
@app.head("/api/health")
@app.get("/health")
@app.head("/health")
def health_check():
    return {"status": "healthy"}


@app.exception_handler(OperationalError)
@app.exception_handler(DatabaseTimeoutError)
async def database_unavailable(request: Request, exc: Exception):
    """Return a clean 503 instead of dropping the connection when the DB is down."""
    return JSONResponse(
        status_code=503,
        content={
            "detail": "The school database is temporarily unavailable. Please try again."
        },
    )


# Serve the whole website (including /admin) from the same backend, so the
# site runs on a single address: http://127.0.0.1:8000
FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "frontend"
)

if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
