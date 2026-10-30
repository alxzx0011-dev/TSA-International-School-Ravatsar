"""Create (or reset) the admin account used by the admin panel.

Usage:
    ../school/bin/python seed_admin.py

Reads ADMIN_EMAIL / ADMIN_PASSWORD from backend/.env.
If ADMIN_PASSWORD is missing, a strong one is generated and saved to .env.
"""

import os
import secrets

from dotenv import load_dotenv
from sqlalchemy import select

import model  # noqa: F401
from database import Base, SessionLocal, engine
from model import User
from security import hash_password

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_PATH)

Base.metadata.create_all(bind=engine)

email = os.getenv("ADMIN_EMAIL", "admin@tsarawatsar.school").strip().lower()
password = os.getenv("ADMIN_PASSWORD")
generated = False

if not password:
    password = secrets.token_urlsafe(12)
    generated = True

    with open(ENV_PATH, "a", encoding="utf-8") as env_file:
        env_file.write(f"\nADMIN_EMAIL={email}\nADMIN_PASSWORD={password}\n")

db = SessionLocal()

try:
    user = db.scalar(select(User).where(User.email == email))

    if user is None:
        db.add(
            User(
                full_name="Site Administrator",
                email=email,
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
        )
        print(f"Admin created: {email}")
    else:
        user.password_hash = hash_password(password)
        user.role = "admin"
        user.is_active = True
        print(f"Admin updated: {email}")

    db.commit()
finally:
    db.close()

if generated:
    print(f"Generated password: {password}")
    print("Saved to backend/.env as ADMIN_PASSWORD")
