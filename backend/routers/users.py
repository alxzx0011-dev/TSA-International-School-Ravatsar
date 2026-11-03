"""Admin user management: create staff, owner, admissions and parent accounts."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from deps import DbSession, require_admin
from model import User
from schemas import ManagedUserCreate, ManagedUserOut, ManagedUserUpdate
from security import hash_password

router = APIRouter(
    prefix="/api/admin/users",
    tags=["Admin users"],
    dependencies=[Depends(require_admin)],
)


def _user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at,
    }


@router.get("", response_model=list[ManagedUserOut])
def list_users(db: DbSession):
    return db.scalars(select(User).order_by(User.role, User.full_name)).all()


@router.post("", response_model=ManagedUserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: ManagedUserCreate, db: DbSession):
    email = data.email.strip().lower()

    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email is already registered")

    user = User(
        full_name=data.full_name.strip(),
        email=email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Account could not be created")

    return user


@router.put("/{user_id}", response_model=ManagedUserOut)
def update_user(user_id: int, data: ManagedUserUpdate, db: DbSession):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    fields = data.model_dump(exclude_unset=True)
    password = fields.pop("password", None)

    if fields.get("full_name"):
        user.full_name = fields["full_name"].strip()

    if fields.get("role"):
        user.role = fields["role"]

    if "is_active" in fields:
        user.is_active = fields["is_active"]

    if password:
        user.password_hash = hash_password(password)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def deactivate_user(user_id: int, db: DbSession):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    db.commit()
    return {"ok": True, "detail": f"{user.email} deactivated"}
