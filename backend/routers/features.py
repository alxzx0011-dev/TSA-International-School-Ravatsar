"""Timetable, homework submissions and leave applications."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from deps import AdminUser, CurrentUser, DbSession, StaffUser
from model import (
    HomeworkSubmission,
    LeaveRequest,
    ParentLink,
    Student,
    TeacherNote,
    TimetableSlot,
    User,
)
from schemas import (
    HomeworkCheck,
    HomeworkSubmit,
    LeaveCreate,
    LeaveDecision,
    TimetableSlotIn,
)

router = APIRouter(prefix="/api", tags=["Timetable, homework & leave"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def student_for_user(db: DbSession, user: User) -> Optional[Student]:
    return db.scalar(select(Student).where(Student.user_id == user.id))


def children_for_parent(db: DbSession, user: User) -> list[Student]:
    linked_ids = db.scalars(
        select(ParentLink.student_id).where(ParentLink.parent_user_id == user.id)
    ).all()

    email = (user.email or "").strip().lower()
    conditions = []
    if linked_ids:
        conditions.append(Student.id.in_(linked_ids))
    if email:
        conditions.append(func.lower(Student.parent_email) == email)

    if not conditions:
        return []

    return list(
        db.scalars(
            select(Student)
            .where(Student.is_active.is_(True), or_(*conditions))
            .order_by(Student.full_name)
        ).all()
    )


def _require_linked_parent(db: DbSession, user: User, student: Student) -> None:
    linked = db.scalar(
        select(ParentLink).where(
            ParentLink.parent_user_id == user.id,
            ParentLink.student_id == student.id,
        )
    )
    email_match = (student.parent_email or "").strip().lower() == (
        user.email or ""
    ).strip().lower()

    if not linked and not email_match:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This student is not linked to your account",
        )


def _slot_dict(slot: TimetableSlot) -> dict:
    return {
        "id": slot.id,
        "class_name": slot.class_name,
        "day_of_week": slot.day_of_week,
        "period": slot.period,
        "subject": slot.subject,
        "teacher_name": slot.teacher_name,
        "room": slot.room,
    }


def _submission_dict(sub: HomeworkSubmission, student_name: Optional[str] = None) -> dict:
    return {
        "id": sub.id,
        "note_id": sub.note_id,
        "student_id": sub.student_id,
        "student_name": student_name,
        "text": sub.text,
        "status": sub.status,
        "remark": sub.remark,
        "checked_by": sub.checked_by,
        "submitted_at": sub.submitted_at,
        "checked_at": sub.checked_at,
    }


def _leave_dict(item: LeaveRequest, student_name: Optional[str] = None) -> dict:
    return {
        "id": item.id,
        "student_id": item.student_id,
        "student_name": student_name,
        "parent_id": item.parent_id,
        "from_date": item.from_date,
        "to_date": item.to_date,
        "reason": item.reason,
        "status": item.status,
        "decided_by": item.decided_by,
        "decided_at": item.decided_at,
        "created_at": item.created_at,
    }


def _homework_notes(db: DbSession, student: Student) -> list[TeacherNote]:
    return list(
        db.scalars(
            select(TeacherNote)
            .where(
                TeacherNote.category == "homework",
                (TeacherNote.student_id == student.id)
                | (
                    TeacherNote.student_id.is_(None)
                    & (TeacherNote.class_name == student.class_name)
                ),
            )
            .order_by(TeacherNote.created_at.desc())
            .limit(100)
        ).all()
    )


def _homework_for_student(db: DbSession, student: Student) -> list[dict]:
    notes = _homework_notes(db, student)
    note_ids = [n.id for n in notes]
    submissions = (
        db.scalars(
            select(HomeworkSubmission).where(
                HomeworkSubmission.student_id == student.id,
                HomeworkSubmission.note_id.in_(note_ids),
            )
        ).all()
        if note_ids
        else []
    )
    by_note = {s.note_id: s for s in submissions}

    result = []
    for note in notes:
        sub = by_note.get(note.id)
        result.append(
            {
                "id": note.id,
                "title": note.title,
                "message": note.message,
                "teacher_name": note.teacher_name,
                "created_at": note.created_at,
                "submission": _submission_dict(sub) if sub else None,
            }
        )
    return result


# ---------------------------------------------------------------------------
# Timetable
# ---------------------------------------------------------------------------
@router.get("/timetable")
def get_timetable(
    db: DbSession,
    user: CurrentUser,
    class_name: Optional[str] = Query(default=None),
):
    if user.role in ("parent", "student"):
        allowed = set()
        if user.role == "student":
            student = student_for_user(db, user)
            if student:
                allowed.add(student.class_name)
        else:
            allowed.update(c.class_name for c in children_for_parent(db, user))

        if class_name and class_name not in allowed:
            raise HTTPException(status_code=403, detail="You cannot view this timetable")
        if not class_name and allowed:
            class_name = sorted(allowed)[0]

    query = select(TimetableSlot)
    if class_name:
        query = query.where(TimetableSlot.class_name == class_name)

    slots = db.scalars(
        query.order_by(
            TimetableSlot.day_of_week, TimetableSlot.period, TimetableSlot.id
        )
    ).all()

    # Keep Monday..Saturday order even though it is stored as text.
    order = {d: i for i, d in enumerate(
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    )}
    slots = sorted(
        slots,
        key=lambda s: (s.class_name, order.get(s.day_of_week, 9), s.period),
    )
    return [_slot_dict(s) for s in slots]


@router.get("/timetable/mine")
def my_timetable(db: DbSession, user: CurrentUser):
    """Timetable for the logged-in student, or every child of a parent."""
    if user.role == "student":
        student = student_for_user(db, user)
        if not student:
            return []
        return [
            {
                "class_name": student.class_name,
                "student_name": student.full_name,
                "slots": [
                    _slot_dict(s)
                    for s in db.scalars(
                        select(TimetableSlot)
                        .where(TimetableSlot.class_name == student.class_name)
                        .order_by(TimetableSlot.period)
                    ).all()
                ],
            }
        ]

    if user.role == "parent":
        response = []
        for child in children_for_parent(db, user):
            response.append(
                {
                    "class_name": child.class_name,
                    "student_name": child.full_name,
                    "slots": [
                        _slot_dict(s)
                        for s in db.scalars(
                            select(TimetableSlot)
                            .where(TimetableSlot.class_name == child.class_name)
                            .order_by(TimetableSlot.period)
                        ).all()
                    ],
                }
            )
        return response

    raise HTTPException(status_code=403, detail="Student or parent access required")


@router.post("/timetable", status_code=status.HTTP_201_CREATED)
def save_timetable_slot(data: TimetableSlotIn, db: DbSession, _: AdminUser):
    class_name = data.class_name.strip()
    existing = db.scalar(
        select(TimetableSlot).where(
            TimetableSlot.class_name == class_name,
            TimetableSlot.day_of_week == data.day_of_week,
            TimetableSlot.period == data.period,
        )
    )

    if existing:
        existing.subject = data.subject.strip()
        existing.teacher_name = _clean(data.teacher_name)
        existing.room = _clean(data.room)
        db.commit()
        db.refresh(existing)
        return _slot_dict(existing)

    slot = TimetableSlot(
        class_name=class_name,
        day_of_week=data.day_of_week,
        period=data.period,
        subject=data.subject.strip(),
        teacher_name=_clean(data.teacher_name),
        room=_clean(data.room),
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return _slot_dict(slot)


@router.delete("/timetable/{slot_id}")
def delete_timetable_slot(slot_id: int, db: DbSession, _: AdminUser):
    slot = db.get(TimetableSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Timetable slot not found")
    db.delete(slot)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Homework
# ---------------------------------------------------------------------------
@router.get("/portal/homework")
def student_homework(db: DbSession, user: CurrentUser):
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Student access required")
    student = student_for_user(db, user)
    if not student:
        raise HTTPException(status_code=404, detail="No student profile linked")
    return _homework_for_student(db, student)


@router.post("/portal/homework/{note_id}/submit")
def submit_homework(note_id: int, data: HomeworkSubmit, db: DbSession, user: CurrentUser):
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Student access required")

    student = student_for_user(db, user)
    if not student:
        raise HTTPException(status_code=404, detail="No student profile linked")

    note = db.get(TeacherNote, note_id)
    if not note or note.category != "homework":
        raise HTTPException(status_code=404, detail="Homework not found")

    allowed = note.student_id == student.id or (
        note.student_id is None and note.class_name == student.class_name
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="This homework is not for you")

    existing = db.scalar(
        select(HomeworkSubmission).where(
            HomeworkSubmission.note_id == note.id,
            HomeworkSubmission.student_id == student.id,
        )
    )

    if existing:
        existing.text = data.text.strip()
        existing.status = "submitted"
        existing.submitted_at = datetime.now(timezone.utc)
        existing.remark = None
        existing.checked_by = None
        existing.checked_at = None
        db.commit()
        db.refresh(existing)
        return _submission_dict(existing, student.full_name)

    sub = HomeworkSubmission(
        note_id=note.id,
        student_id=student.id,
        text=data.text.strip(),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return _submission_dict(sub, student.full_name)


@router.get("/parent/homework")
def parent_homework(db: DbSession, user: CurrentUser):
    if user.role != "parent":
        raise HTTPException(status_code=403, detail="Parent access required")

    return [
        {
            "student_id": child.id,
            "student_name": child.full_name,
            "class_name": child.class_name,
            "homework": _homework_for_student(db, child),
        }
        for child in children_for_parent(db, user)
    ]


@router.get("/teacher/homework/{note_id}/submissions")
def homework_submissions(note_id: int, db: DbSession, _: StaffUser):
    note = db.get(TeacherNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Homework not found")

    rows = db.execute(
        select(HomeworkSubmission, Student.full_name)
        .join(Student, Student.id == HomeworkSubmission.student_id)
        .where(HomeworkSubmission.note_id == note_id)
        .order_by(HomeworkSubmission.submitted_at.desc())
    ).all()

    return [_submission_dict(sub, name) for sub, name in rows]


@router.put("/teacher/homework/submissions/{submission_id}")
def check_homework(
    submission_id: int,
    data: HomeworkCheck,
    db: DbSession,
    user: StaffUser,
):
    sub = db.get(HomeworkSubmission, submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub.status = data.status
    sub.remark = _clean(data.remark)
    sub.checked_by = user.full_name
    sub.checked_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sub)

    student = db.get(Student, sub.student_id)
    return _submission_dict(sub, student.full_name if student else None)


# ---------------------------------------------------------------------------
# Leave applications
# ---------------------------------------------------------------------------
@router.post("/parent/leave", status_code=status.HTTP_201_CREATED)
def create_leave(data: LeaveCreate, db: DbSession, user: CurrentUser):
    if user.role != "parent":
        raise HTTPException(status_code=403, detail="Parent access required")

    student = db.get(Student, data.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    _require_linked_parent(db, user, student)

    item = LeaveRequest(
        student_id=student.id,
        parent_id=user.id,
        from_date=data.from_date,
        to_date=data.to_date,
        reason=data.reason.strip(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _leave_dict(item, student.full_name)


@router.get("/parent/leave")
def parent_leave(db: DbSession, user: CurrentUser):
    if user.role != "parent":
        raise HTTPException(status_code=403, detail="Parent access required")

    children = children_for_parent(db, user)
    names = {c.id: c.full_name for c in children}

    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.parent_id == user.id)
        .order_by(LeaveRequest.created_at.desc())
    ).all()

    return [_leave_dict(r, names.get(r.student_id)) for r in rows]


@router.get("/portal/leave")
def student_leave(db: DbSession, user: CurrentUser):
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Student access required")

    student = student_for_user(db, user)
    if not student:
        return []

    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.student_id == student.id)
        .order_by(LeaveRequest.created_at.desc())
    ).all()

    return [_leave_dict(r, student.full_name) for r in rows]


@router.get("/teacher/leave")
def teacher_leave(
    db: DbSession,
    _: StaffUser,
    status_filter: Optional[str] = Query(default=None, alias="status"),
):
    query = select(LeaveRequest)
    if status_filter:
        query = query.where(LeaveRequest.status == status_filter)

    rows = db.scalars(
        query.order_by(LeaveRequest.created_at.desc()).limit(300)
    ).all()

    student_ids = {r.student_id for r in rows}
    names = {}
    if student_ids:
        for student in db.scalars(
            select(Student).where(Student.id.in_(student_ids))
        ).all():
            names[student.id] = student.full_name

    return [_leave_dict(r, names.get(r.student_id)) for r in rows]


@router.put("/teacher/leave/{leave_id}")
def decide_leave(
    leave_id: int,
    data: LeaveDecision,
    db: DbSession,
    user: StaffUser,
):
    item = db.get(LeaveRequest, leave_id)
    if not item:
        raise HTTPException(status_code=404, detail="Leave request not found")

    item.status = data.status
    item.decided_by = user.full_name
    item.decided_at = datetime.now(timezone.utc)
    if data.note:
        item.reason = f"{item.reason}\n\nDecision note: {data.note.strip()}"

    db.commit()
    db.refresh(item)

    student = db.get(Student, item.student_id)
    return _leave_dict(item, student.full_name if student else None)
