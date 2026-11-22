import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from auth_utils import create_access_token
from deps import CurrentUser, DbSession
from email_service import EmailError, send_password_reset_email
from model import PasswordResetOTP, User
from ratelimit import rate_limit
from schemas import (
    ForgotPassword,
    PasswordChange,
    ResetPassword,
    Token,
    UserCreate,
    UserLogin,
    UserResponse,
)
from security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["Authentication"])

logger = logging.getLogger(__name__)

RESET_CODE_MINUTES = 10
RESET_MAX_ATTEMPTS = 5
RESET_RESEND_SECONDS = 60


@router.post(
    "/register",
    dependencies=[Depends(rate_limit("register", 5, 3600))],
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_user(data: UserCreate, db: DbSession):
    email = data.email.strip().lower()

    existing_user = db.scalar(select(User).where(User.email == email))

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        )

    user = User(
        full_name=data.full_name.strip(),
        email=email,
        password_hash=hash_password(data.password),
        role="student",
    )

    db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account could not be created; check existing details",
        )

    return user


@router.post(
    "/login",
    response_model=Token,
    dependencies=[Depends(rate_limit("login", 10, 300))],
)
def login_user(data: UserLogin, db: DbSession):
    email = data.email.strip().lower()

    user = db.scalar(select(User).where(User.email == email))

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is disabled",
        )

    token = create_access_token(user.id, user.role)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user,
    }


@router.get("/me", response_model=UserResponse)
def read_current_user(user: CurrentUser):
    return user


@router.post("/change-password")
def change_password(data: PasswordChange, user: CurrentUser, db: DbSession):
    """Let any signed-in user replace their own password."""
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your current password is incorrect",
        )

    if data.current_password == data.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password must be different",
        )

    user.password_hash = hash_password(data.new_password)
    db.commit()

    return {"ok": True, "detail": "Password updated successfully"}


# ---------------------------------------------------------------------------
# Forgot password (email OTP)
# ---------------------------------------------------------------------------
def _as_utc(value):
    """SQLite returns naive datetimes; Supabase returns timezone-aware ones."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@router.post(
    "/forgot-password",
    dependencies=[Depends(rate_limit("forgot_password", 5, 900))],
)
def forgot_password(data: ForgotPassword, db: DbSession):
    generic = {
        "ok": True,
        "detail": (
            "If this email is registered, a 6-digit code has been sent. "
            "Please check your inbox and spam folder."
        ),
    }

    email = data.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))

    # Always return the same answer so nobody can discover registered emails.
    if user is None or not user.is_active:
        return generic

    now = datetime.now(timezone.utc)

    latest = db.scalar(
        select(PasswordResetOTP)
        .where(PasswordResetOTP.user_id == user.id)
        .order_by(PasswordResetOTP.created_at.desc())
        .limit(1)
    )
    created = _as_utc(latest.created_at) if latest else None
    if created and (now - created).total_seconds() < RESET_RESEND_SECONDS:
        return generic

    for old in db.scalars(
        select(PasswordResetOTP).where(
            PasswordResetOTP.user_id == user.id,
            PasswordResetOTP.used_at.is_(None),
        )
    ).all():
        old.used_at = now

    otp = f"{secrets.randbelow(900000) + 100000}"

    record = PasswordResetOTP(
        user_id=user.id,
        otp_hash=hash_password(otp),
        expires_at=now + timedelta(minutes=RESET_CODE_MINUTES),
    )
    db.add(record)
    db.commit()

    try:
        send_password_reset_email(user.email, user.full_name, otp)
    except EmailError:
        logger.exception("Password reset email failed for user %s", user.id)

    return generic


@router.post(
    "/reset-password",
    dependencies=[Depends(rate_limit("reset_password", 10, 900))],
)
def reset_password(data: ResetPassword, db: DbSession):
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This code is invalid or has expired. Please request a new code.",
    )

    email = data.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        raise invalid

    now = datetime.now(timezone.utc)
    record = db.scalar(
        select(PasswordResetOTP)
        .where(
            PasswordResetOTP.user_id == user.id,
            PasswordResetOTP.used_at.is_(None),
        )
        .order_by(PasswordResetOTP.created_at.desc())
        .limit(1)
    )

    if record is None:
        raise invalid

    expires = _as_utc(record.expires_at)
    if expires is None or expires < now or record.attempts >= RESET_MAX_ATTEMPTS:
        raise invalid

    if not verify_password(data.otp, record.otp_hash):
        record.attempts += 1
        db.commit()
        raise invalid

    if verify_password(data.new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a password that is different from your current one.",
        )

    record.used_at = now
    user.password_hash = hash_password(data.new_password)

    for other in db.scalars(
        select(PasswordResetOTP).where(
            PasswordResetOTP.user_id == user.id,
            PasswordResetOTP.used_at.is_(None),
            PasswordResetOTP.id != record.id,
        )
    ).all():
        other.used_at = now

    db.commit()

    return {
        "ok": True,
        "detail": "Password updated. You can now sign in with your new password.",
    }
