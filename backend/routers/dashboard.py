from fastapi import APIRouter
from sqlalchemy import func, select

from deps import AdminUser, DbSession
from model import (
    Admission,
    Attendance,
    ContactMessage,
    Event,
    ExamResult,
    FeeRecord,
    Faculty,
    GalleryItem,
    News,
    Notice,
    Student,
)

router = APIRouter(prefix="/api/admin/dashboard", tags=["Admin dashboard"])


@router.get("")
def dashboard_stats(db: DbSession, _: AdminUser):
    total_admissions = db.scalar(select(func.count()).select_from(Admission)) or 0
    new_admissions = (
        db.scalar(
            select(func.count())
            .select_from(Admission)
            .where(Admission.status == "new")
        )
        or 0
    )
    total_messages = db.scalar(select(func.count()).select_from(ContactMessage)) or 0
    unread_messages = (
        db.scalar(
            select(func.count())
            .select_from(ContactMessage)
            .where(ContactMessage.is_read.is_(False))
        )
        or 0
    )

    recent_admissions = db.scalars(
        select(Admission).order_by(Admission.created_at.desc()).limit(5)
    ).all()
    recent_messages = db.scalars(
        select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(5)
    ).all()

    from datetime import date as _date

    today = _date.today()
    total_students = db.scalar(select(func.count()).select_from(Student).where(Student.is_active.is_(True))) or 0
    today_marked = db.scalar(
        select(func.count()).select_from(Attendance).where(Attendance.day == today)
    ) or 0
    today_present = db.scalar(
        select(func.count())
        .select_from(Attendance)
        .where(Attendance.day == today, Attendance.status == "present")
    ) or 0
    unpaid_fees = db.scalar(
        select(func.count()).select_from(FeeRecord).where(FeeRecord.status == "unpaid")
    ) or 0
    pending_amount = db.scalar(
        select(func.coalesce(func.sum(FeeRecord.amount), 0)).where(FeeRecord.status == "unpaid")
    ) or 0

    return {
        "admissions": {"total": total_admissions, "new": new_admissions},
        "messages": {"total": total_messages, "unread": unread_messages},
        "management": {
            "students": total_students,
            "attendance_today": {"marked": today_marked, "present": today_present},
            "fees": {"unpaid_count": unpaid_fees, "pending_amount": float(pending_amount)},
        },
        "counts": {
            "news": db.scalar(select(func.count()).select_from(News)) or 0,
            "notices": db.scalar(select(func.count()).select_from(Notice)) or 0,
            "events": db.scalar(select(func.count()).select_from(Event)) or 0,
            "gallery": db.scalar(select(func.count()).select_from(GalleryItem)) or 0,
            "faculty": db.scalar(select(func.count()).select_from(Faculty)) or 0,
        },
        "recent_admissions": [
            {
                "id": item.id,
                "student_name": item.student_name,
                "parent_name": item.parent_name,
                "class_name": item.class_name,
                "status": item.status,
                "created_at": item.created_at,
            }
            for item in recent_admissions
        ],
        "recent_messages": [
            {
                "id": item.id,
                "full_name": item.full_name,
                "subject": item.subject,
                "is_read": item.is_read,
                "created_at": item.created_at,
            }
            for item in recent_messages
        ],
    }
