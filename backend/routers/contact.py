from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from deps import AdminUser, DbSession, require_admin
from model import ContactMessage
from schemas import ContactCreate, ContactOut

router = APIRouter(prefix="/api/contact", tags=["Contact"])


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_message(data: ContactCreate, db: DbSession):
    message = ContactMessage(**data.model_dump())

    db.add(message)
    db.commit()
    db.refresh(message)

    return message


@router.get(
    "",
    response_model=list[ContactOut],
    dependencies=[Depends(require_admin)],
)
def list_messages(
    db: DbSession,
    unread_only: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(ContactMessage)
        .order_by(ContactMessage.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    if unread_only:
        stmt = stmt.where(ContactMessage.is_read.is_(False))

    return db.scalars(stmt).all()


@router.patch("/{message_id}/read", response_model=ContactOut)
def mark_read(message_id: int, db: DbSession, _: AdminUser):
    message = db.get(ContactMessage, message_id)

    if message is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found",
        )

    message.is_read = True
    db.commit()
    db.refresh(message)

    return message


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(message_id: int, db: DbSession, _: AdminUser):
    message = db.get(ContactMessage, message_id)

    if message is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found",
        )

    db.delete(message)
    db.commit()
