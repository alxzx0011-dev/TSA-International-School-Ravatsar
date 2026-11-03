"""Parent and teacher portal endpoints."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from deps import CurrentUser, DbSession, StaffUser
from model import (
    Attendance,
    ExamResult,
    FeeRecord,
    Notice,
    ParentComplaint,
    ParentLink,
    Student,
    TeacherNote,
)
from schemas import (
    ComplaintCreate,
    ComplaintRespond,
    TeacherNoteCreate,
)
from routers.management import student_dict

parent = APIRouter(prefix="/api/parent", tags=["Parent portal"])
teacher = APIRouter(prefix="/api/teacher", tags=["Teacher portal"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _require_parent(user: CurrentUser) -> None:
    if user.role != "parent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Parent access required",
        )


def _note_dict(note: TeacherNote, student_name: Optional[str] = None) -> dict:
    return {
        "id": note.id,
        "student_id": note.student_id,
        "class_name": note.class_name,
        "teacher_name": note.teacher_name,
        "title": note.title,
        "message": note.message,
        "category": note.category,
        "visible_to_parent": note.visible_to_parent,
        "created_at": note.created_at,
        "student_name": student_name,
    }


def _complaint_dict(complaint: ParentComplaint, student_name: Optional[str] = None) -> dict:
    return {
        "id": complaint.id,
        "student_id": complaint.student_id,
        "parent_id": complaint.parent_id,
        "parent_name": complaint.parent_name,
        "subject": complaint.subject,
        "message": complaint.message,
        "status": complaint.status,
        "response": complaint.response,
        "responded_by": complaint.responded_by,
        "responded_at": complaint.responded_at,
        "created_at": complaint.created_at,
        "student_name": student_name,
    }


def _notes_for_student(db: DbSession, student: Student, limit: int = 30):
    return db.scalars(
        select(TeacherNote)
        .where(
            TeacherNote.visible_to_parent.is_(True),
            (TeacherNote.student_id == student.id)
            | (
                TeacherNote.student_id.is_(None)
                & (TeacherNote.class_name == student.class_name)
            ),
        )
        .order_by(TeacherNote.created_at.desc())
        .limit(limit)
    ).all()


def _child_payload(db: DbSession, student: Student) -> dict:
    attendance_rows = db.scalars(
        select(Attendance)
        .where(Attendance.student_id == student.id)
        .order_by(Attendance.day.desc())
    ).all()

    present = sum(1 for a in attendance_rows if a.status == "present")
    absent = sum(1 for a in attendance_rows if a.status == "absent")
    leave = sum(1 for a in attendance_rows if a.status == "leave")
    total = len(attendance_rows)
    percent = round((present / total) * 100, 1) if total else 0.0

    fees = db.scalars(
        select(FeeRecord)
        .where(FeeRecord.student_id == student.id)
        .order_by(FeeRecord.id.desc())
    ).all()

    results = db.scalars(
        select(ExamResult)
        .where(ExamResult.student_id == student.id)
        .order_by(ExamResult.exam_name, ExamResult.subject)
    ).all()

    notes = _notes_for_student(db, student)

    return {
        "profile": student_dict(db, student),
        "attendance": {
            "present": present,
            "absent": absent,
            "leave": leave,
            "total": total,
            "percent": percent,
            "recent": [{"day": a.day, "status": a.status} for a in attendance_rows[:15]],
        },
        "fees": [
            {
                "id": f.id,
                "title": f.title,
                "amount": f.amount,
                "due_date": f.due_date,
                "status": f.status,
                "paid_at": f.paid_at,
            }
            for f in fees
        ],
        "results": [
            {
                "id": r.id,
                "exam_name": r.exam_name,
                "subject": r.subject,
                "marks_obtained": r.marks_obtained,
                "total_marks": r.total_marks,
                "percent": round((r.marks_obtained / r.total_marks) * 100, 1)
                if r.total_marks
                else 0,
            }
            for r in results
        ],
        "notes": [_note_dict(n) for n in notes],
    }


# ---------------------------------------------------------------------------
# Parent portal
# ---------------------------------------------------------------------------
@parent.get("/me")
def parent_me(user: CurrentUser, db: DbSession):
    _require_parent(user)

    email = (user.email or "").strip().lower()

    linked_ids = db.scalars(
        select(ParentLink.student_id).where(ParentLink.parent_user_id == user.id)
    ).all()

    conditions = []
    if linked_ids:
        conditions.append(Student.id.in_(linked_ids))
    if email:
        conditions.append(func.lower(Student.parent_email) == email)

    children = []
    if conditions:
        children = db.scalars(
            select(Student)
            .where(Student.is_active.is_(True), or_(*conditions))
            .order_by(Student.full_name)
        ).all()

    complaints = db.scalars(
        select(ParentComplaint)
        .where(ParentComplaint.parent_id == user.id)
        .order_by(ParentComplaint.created_at.desc())
    ).all()

    notices = db.scalars(
        select(Notice)
        .where(Notice.is_active.is_(True))
        .order_by(Notice.created_at.desc())
        .limit(10)
    ).all()

    return {
        "parent": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
        },
        "children": [_child_payload(db, child) for child in children],
        "complaints": [
            _complaint_dict(c, next((s.full_name for s in children if s.id == c.student_id), None))
            for c in complaints
        ],
        "notices": [
            {"id": n.id, "title": n.title, "message": n.message, "created_at": n.created_at}
            for n in notices
        ],
    }


@parent.post("/complaints", status_code=status.HTTP_201_CREATED)
def create_complaint(data: ComplaintCreate, user: CurrentUser, db: DbSession):
    _require_parent(user)

    student = db.get(Student, data.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    linked = db.scalar(
        select(ParentLink).where(
            ParentLink.parent_user_id == user.id,
            ParentLink.student_id == student.id,
        )
    )
    email_match = (student.parent_email or "").strip().lower() == (user.email or "").strip().lower()

    if not linked and not email_match:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This student is not linked to your account",
        )

    complaint = ParentComplaint(
        student_id=student.id,
        parent_id=user.id,
        parent_name=user.full_name,
        subject=data.subject.strip(),
        message=data.message.strip(),
    )
    db.add(complaint)
    db.commit()
    db.refresh(complaint)

    return _complaint_dict(complaint, student.full_name)


# ---------------------------------------------------------------------------
# Teacher portal
# ---------------------------------------------------------------------------
@teacher.get("/students")
def teacher_students(
    db: DbSession,
    _: StaffUser,
    class_name: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    query = select(Student).where(Student.is_active.is_(True))

    if class_name:
        query = query.where(Student.class_name == class_name)

    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            Student.full_name.ilike(term) | Student.admission_no.ilike(term)
        )

    students = db.scalars(
        query.order_by(Student.class_name, Student.roll_no, Student.full_name)
    ).all()
    return [student_dict(db, s) for s in students]


@teacher.get("/notes")
def teacher_notes(
    db: DbSession,
    user: StaffUser,
    student_id: Optional[int] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
):
    query = select(TeacherNote)

    if user.role == "teacher":
        query = query.where(TeacherNote.teacher_id == user.id)

    if student_id:
        query = query.where(TeacherNote.student_id == student_id)

    if class_name:
        query = query.where(TeacherNote.class_name == class_name)

    notes = db.scalars(query.order_by(TeacherNote.created_at.desc()).limit(200)).all()

    student_ids = {n.student_id for n in notes if n.student_id}
    names = {}
    if student_ids:
        for student in db.scalars(select(Student).where(Student.id.in_(student_ids))).all():
            names[student.id] = student.full_name

    return [_note_dict(n, names.get(n.student_id)) for n in notes]


@teacher.post("/notes", status_code=status.HTTP_201_CREATED)
def create_teacher_note(data: TeacherNoteCreate, db: DbSession, user: StaffUser):
    student = None
    class_name = (data.class_name or "").strip() or None

    if data.student_id:
        student = db.get(Student, data.student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        class_name = student.class_name

    note = TeacherNote(
        student_id=student.id if student else None,
        class_name=class_name,
        teacher_id=user.id,
        teacher_name=user.full_name,
        title=data.title.strip(),
        message=data.message.strip(),
        category=data.category,
        visible_to_parent=data.visible_to_parent,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return _note_dict(note, student.full_name if student else None)


@teacher.delete("/notes/{note_id}")
def delete_teacher_note(note_id: int, db: DbSession, user: StaffUser):
    note = db.get(TeacherNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if user.role == "teacher" and note.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own notes")

    db.delete(note)
    db.commit()
    return {"ok": True}


@teacher.get("/complaints")
def teacher_complaints(
    db: DbSession,
    _: StaffUser,
    status_filter: Optional[str] = Query(default=None, alias="status"),
):
    query = select(ParentComplaint)

    if status_filter:
        query = query.where(ParentComplaint.status == status_filter)

    complaints = db.scalars(
        query.order_by(ParentComplaint.created_at.desc()).limit(200)
    ).all()

    student_ids = {c.student_id for c in complaints}
    names = {}
    if student_ids:
        for student in db.scalars(select(Student).where(Student.id.in_(student_ids))).all():
            names[student.id] = student.full_name

    return [_complaint_dict(c, names.get(c.student_id)) for c in complaints]


@teacher.put("/complaints/{complaint_id}")
def respond_to_complaint(
    complaint_id: int,
    data: ComplaintRespond,
    db: DbSession,
    user: StaffUser,
):
    complaint = db.get(ParentComplaint, complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    complaint.response = data.response.strip()
    complaint.status = data.status
    complaint.responded_by = user.full_name
    complaint.responded_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(complaint)

    student = db.get(Student, complaint.student_id)
    return _complaint_dict(complaint, student.full_name if student else None)


@teacher.get("/summary")
def teacher_summary(db: DbSession, user: StaffUser):
    student_count = db.scalar(
        select(func.count()).select_from(Student).where(Student.is_active.is_(True))
    ) or 0

    note_query = select(func.count()).select_from(TeacherNote)
    if user.role == "teacher":
        note_query = note_query.where(TeacherNote.teacher_id == user.id)
    note_count = db.scalar(note_query) or 0

    open_complaints = db.scalar(
        select(func.count())
        .select_from(ParentComplaint)
        .where(ParentComplaint.status == "open")
    ) or 0

    return {
        "students": student_count,
        "notes": note_count,
        "open_complaints": open_complaints,
    }
