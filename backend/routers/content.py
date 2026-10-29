from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from deps import DbSession, require_admin
from model import Event, Faculty, GalleryItem, News, Notice
from schemas import (
    EventCreate,
    EventOut,
    EventUpdate,
    FacultyCreate,
    FacultyOut,
    FacultyUpdate,
    GalleryCreate,
    GalleryOut,
    GalleryUpdate,
    NewsCreate,
    NewsOut,
    NewsUpdate,
    NoticeCreate,
    NoticeOut,
    NoticeUpdate,
)

public = APIRouter(prefix="/api", tags=["Website content"])
admin = APIRouter(
    prefix="/api/admin",
    tags=["Admin content"],
    dependencies=[Depends(require_admin)],
)


def get_or_404(db: Session, model, item_id: int, label: str):
    item = db.get(model, item_id)

    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{label} not found",
        )

    return item


def apply_update(item, data):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    return item


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------
@public.get("/news", response_model=list[NewsOut])
def public_news(
    db: DbSession,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(News)
        .where(News.is_published.is_(True))
        .order_by(News.published_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return db.scalars(stmt).all()


@public.get("/news/{news_id}", response_model=NewsOut)
def public_news_item(news_id: int, db: DbSession):
    item = get_or_404(db, News, news_id, "News")

    if not item.is_published:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="News not found",
        )

    return item


@admin.get("/news", response_model=list[NewsOut])
def admin_news(db: DbSession):
    return db.scalars(select(News).order_by(News.created_at.desc())).all()


@admin.post("/news", response_model=NewsOut, status_code=status.HTTP_201_CREATED)
def create_news(data: NewsCreate, db: DbSession):
    item = News(**data.model_dump())

    db.add(item)
    db.commit()
    db.refresh(item)

    return item


@admin.put("/news/{news_id}", response_model=NewsOut)
def update_news(news_id: int, data: NewsUpdate, db: DbSession):
    item = apply_update(get_or_404(db, News, news_id, "News"), data)

    db.commit()
    db.refresh(item)

    return item


@admin.delete("/news/{news_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_news(news_id: int, db: DbSession):
    db.delete(get_or_404(db, News, news_id, "News"))
    db.commit()


# ---------------------------------------------------------------------------
# Notices
# ---------------------------------------------------------------------------
@public.get("/notices", response_model=list[NoticeOut])
def public_notices(db: DbSession):
    stmt = (
        select(Notice)
        .where(Notice.is_active.is_(True))
        .order_by(Notice.created_at.desc())
    )
    return db.scalars(stmt).all()


@admin.get("/notices", response_model=list[NoticeOut])
def admin_notices(db: DbSession):
    return db.scalars(select(Notice).order_by(Notice.created_at.desc())).all()


@admin.post(
    "/notices",
    response_model=NoticeOut,
    status_code=status.HTTP_201_CREATED,
)
def create_notice(data: NoticeCreate, db: DbSession):
    item = Notice(**data.model_dump())

    db.add(item)
    db.commit()
    db.refresh(item)

    return item


@admin.put("/notices/{notice_id}", response_model=NoticeOut)
def update_notice(notice_id: int, data: NoticeUpdate, db: DbSession):
    item = apply_update(get_or_404(db, Notice, notice_id, "Notice"), data)

    db.commit()
    db.refresh(item)

    return item


@admin.delete("/notices/{notice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notice(notice_id: int, db: DbSession):
    db.delete(get_or_404(db, Notice, notice_id, "Notice"))
    db.commit()


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------
@public.get("/events", response_model=list[EventOut])
def public_events(db: DbSession):
    stmt = (
        select(Event)
        .where(Event.is_active.is_(True))
        .order_by(Event.event_date.asc())
    )
    return db.scalars(stmt).all()


@admin.get("/events", response_model=list[EventOut])
def admin_events(db: DbSession):
    return db.scalars(select(Event).order_by(Event.event_date.desc())).all()


@admin.post(
    "/events",
    response_model=EventOut,
    status_code=status.HTTP_201_CREATED,
)
def create_event(data: EventCreate, db: DbSession):
    item = Event(**data.model_dump())

    db.add(item)
    db.commit()
    db.refresh(item)

    return item


@admin.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: int, data: EventUpdate, db: DbSession):
    item = apply_update(get_or_404(db, Event, event_id, "Event"), data)

    db.commit()
    db.refresh(item)

    return item


@admin.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: DbSession):
    db.delete(get_or_404(db, Event, event_id, "Event"))
    db.commit()


# ---------------------------------------------------------------------------
# Gallery
# ---------------------------------------------------------------------------
@public.get("/gallery", response_model=list[GalleryOut])
def public_gallery(
    db: DbSession,
    category: str | None = Query(default=None),
):
    stmt = (
        select(GalleryItem)
        .where(GalleryItem.is_active.is_(True))
        .order_by(GalleryItem.sort_order.asc(), GalleryItem.created_at.desc())
    )

    if category:
        stmt = stmt.where(GalleryItem.category == category)

    return db.scalars(stmt).all()


@admin.get("/gallery", response_model=list[GalleryOut])
def admin_gallery(db: DbSession):
    return db.scalars(
        select(GalleryItem).order_by(GalleryItem.sort_order.asc())
    ).all()


@admin.post(
    "/gallery",
    response_model=GalleryOut,
    status_code=status.HTTP_201_CREATED,
)
def create_gallery_item(data: GalleryCreate, db: DbSession):
    item = GalleryItem(**data.model_dump())

    db.add(item)
    db.commit()
    db.refresh(item)

    return item


@admin.put("/gallery/{item_id}", response_model=GalleryOut)
def update_gallery_item(item_id: int, data: GalleryUpdate, db: DbSession):
    item = apply_update(get_or_404(db, GalleryItem, item_id, "Gallery item"), data)

    db.commit()
    db.refresh(item)

    return item


@admin.delete("/gallery/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gallery_item(item_id: int, db: DbSession):
    db.delete(get_or_404(db, GalleryItem, item_id, "Gallery item"))
    db.commit()


# ---------------------------------------------------------------------------
# Faculty
# ---------------------------------------------------------------------------
@public.get("/faculty", response_model=list[FacultyOut])
def public_faculty(db: DbSession):
    stmt = (
        select(Faculty)
        .where(Faculty.is_active.is_(True))
        .order_by(Faculty.sort_order.asc())
    )
    return db.scalars(stmt).all()


@admin.get("/faculty", response_model=list[FacultyOut])
def admin_faculty(db: DbSession):
    return db.scalars(select(Faculty).order_by(Faculty.sort_order.asc())).all()


@admin.post(
    "/faculty",
    response_model=FacultyOut,
    status_code=status.HTTP_201_CREATED,
)
def create_faculty(data: FacultyCreate, db: DbSession):
    item = Faculty(**data.model_dump())

    db.add(item)
    db.commit()
    db.refresh(item)

    return item


@admin.put("/faculty/{faculty_id}", response_model=FacultyOut)
def update_faculty(faculty_id: int, data: FacultyUpdate, db: DbSession):
    item = apply_update(get_or_404(db, Faculty, faculty_id, "Faculty member"), data)

    db.commit()
    db.refresh(item)

    return item


@admin.delete("/faculty/{faculty_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_faculty(faculty_id: int, db: DbSession):
    db.delete(get_or_404(db, Faculty, faculty_id, "Faculty member"))
    db.commit()
