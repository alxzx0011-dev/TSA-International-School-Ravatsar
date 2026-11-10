from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from auth_utils import create_access_token
from deps import CurrentUser, DbSession
from ratelimit import rate_limit
from model import User
from schemas import PasswordChange, Token, UserCreate, UserLogin, UserResponse
from security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["Authentication"])


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
