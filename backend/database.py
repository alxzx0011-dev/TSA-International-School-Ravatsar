import os
import time

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load environment variables from backend/.env
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Check backend/.env"
    )

engine_kwargs = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
    "pool_size": 5,
    "max_overflow": 5,
    "pool_timeout": 10,
}

# Fail fast instead of hanging forever when the database is unreachable.
if DATABASE_URL.startswith("postgresql"):
    connect_args = {
        "connect_timeout": 10,
        # Stop any single SQL statement from hanging the login request forever.
        "options": "-c statement_timeout=20000",
    }

    # Supabase's connection pooler (PgBouncer) does not support server-side
    # prepared statements. Disable them when a pooler URL is used.
    is_pooler = "pooler.supabase.com" in DATABASE_URL or ":6543" in DATABASE_URL
    if is_pooler and "psycopg2" not in DATABASE_URL:
        connect_args["prepare_threshold"] = None

    engine_kwargs["connect_args"] = connect_args

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def init_db(retries: int = 3, delay: float = 2.0) -> None:
    """Create missing tables, retrying briefly on startup network errors."""
    last_error = None

    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except Exception as exc:  # noqa: BLE001 - startup resilience
            last_error = exc
            print(f"Database init attempt {attempt}/{retries} failed: {exc}")
            if attempt < retries:
                time.sleep(delay)

    raise RuntimeError("Could not initialize the database") from last_error


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
