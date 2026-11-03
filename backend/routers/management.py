"""School management system: students, attendance, fees, results + student portal."""

import secrets
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from deps import AdminUser, CurrentUser, DbSession, StaffUser
from model import Attendance, ExamResult, FeeRecord, Notice, ParentLink, Student, TeacherNote, User
from schemas import (
    AttendanceMark,
    AttendanceOut,
    FeeCreate,
    FeeOut,
    FeeUpdate,
    ResultBulk,
    ResultCreate,
    ResultOut,
    StudentCreate,
    StudentCreateResponse,
    StudentOut,
    StudentUpdate,
)
from security import hash_password

router = APIRouter(prefix="/api", tags=["School management"])

CLASS_LIST = [
    "Pre-Primary",
    "Class 1",
    "Class 2",
    "Class 3",
    "Class 4",
    "Class 5",
    "Class 6",
    "Class 7",
    "Class 8",
    "Class 9",
    "Class 10",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def student_dict(db: DbSession, student: Student) -> dict:
    email = None
    if student.user_id:
        user = db.get(User, student.user_id)
        email = user.email if user else None

    parent_login_email = None
    link = db.scalar(
        select(ParentLink).where(ParentLink.student_id == student.id).limit(1)
    )
    if link:
        parent_user = db.get(User, link.parent_user_id)
        parent_login_email = parent_user.email if parent_user else None

    return {
        "id": student.id,
        "admission_no": student.admission_no,
        "full_name": student.full_name,
        "class_name": student.class_name,
        "roll_no": student.roll_no,
        "gender": student.gender,
        "dob": student.dob,
        "parent_name": student.parent_name,
        "parent_phone": student.parent_phone,
        "parent_email": student.parent_email,
        "parent_login_email": parent_login_email,
        "is_active": student.is_active,
        "login_email": email,
        "created_at": student.created_at,
    }


def _unique_admission_no(db: DbSession, base: str) -> str:
    base = (base or "ADM").strip().upper()[:20]
    candidate = base
    counter = 1
    while db.scalar(select(Student).where(Student.admission_no == candidate)):
        counter += 1
        candidate = f"{base}-{counter}"
    return candidate


def _make_login(db: DbSession, student: Student, email: Optional[str], password: Optional[str]):
    """Create (or reuse) a student login account. Returns credentials dict."""
    email = (email or "").strip().lower() or f"{student.admission_no.lower()}@student.tsarawatsar.school"
    password = password or f"Sms{secrets.token_hex(3)}"

    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        if existing.role != "student":
            raise HTTPException(status_code=409, detail="Email already belongs to another account")
        if student.user_id != existing.id:
            existing.password_hash = hash_password(password)
            existing.is_active = True
            student.user_id = existing.id
        return {"email": existing.email, "password": password}

    user = User(
        full_name=student.full_name,
        email=email,
        password_hash=hash_password(password),
        role="student",
    )
    db.add(user)
    db.flush()
    student.user_id = user.id
    return {"email": email, "password": password}


def _make_parent_login(db: DbSession, student: Student, force_reset: bool = False):
    """Create (or reset) a parent login linked by the student's parent email."""
    email = (student.parent_email or "").strip().lower()
    if not email:
        return None

    def link(parent: User):
        found = db.scalar(
            select(ParentLink).where(
                ParentLink.parent_user_id == parent.id,
                ParentLink.student_id == student.id,
            )
        )
        if not found:
            db.add(ParentLink(parent_user_id=parent.id, student_id=student.id))

    def reset_password(parent: User):
        password = f"Tsa{secrets.token_hex(3)}"
        parent.password_hash = hash_password(password)
        parent.is_active = True
        return {"email": parent.email, "password": password}

    existing = db.scalar(select(User).where(User.email == email))

    if existing and existing.role == "parent":
        link(existing)
        if force_reset:
            return reset_password(existing)
        return {"email": existing.email, "password": None, "existing": True}

    # The parent email may already belong to a student or staff login. In that
    # case create a dedicated parent login instead of overwriting that account.
    if existing:
        safe_no = "".join(
            ch for ch in student.admission_no.lower() if ch.isalnum() or ch in "-"
        )
        fallback_email = f"parent.{safe_no}@tsarawatsar.school"
        parent = db.scalar(select(User).where(User.email == fallback_email))

        if parent:
            link(parent)
            if force_reset:
                return reset_password(parent)
            return {"email": parent.email, "password": None, "existing": True}

        password = f"Tsa{secrets.token_hex(3)}"
        parent = User(
            full_name=student.parent_name or f"Parent of {student.full_name}",
            email=fallback_email,
            password_hash=hash_password(password),
            role="parent",
        )
        db.add(parent)
        db.flush()
        link(parent)
        return {"email": fallback_email, "password": password}

    password = f"Tsa{secrets.token_hex(3)}"
    parent = User(
        full_name=student.parent_name or f"Parent of {student.full_name}",
        email=email,
        password_hash=hash_password(password),
        role="parent",
    )
    db.add(parent)
    db.flush()
    link(parent)
    return {"email": email, "password": password}


# ---------------------------------------------------------------------------
# Classes (helper for frontend dropdowns)
# ---------------------------------------------------------------------------
@router.get("/classes")
def list_classes():
    return CLASS_LIST


# ---------------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------------
@router.get("/students")
def list_students(
    db: DbSession,
    _: StaffUser,
    class_name: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    query = select(Student)

    if class_name:
        query = query.where(Student.class_name == class_name)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            Student.full_name.ilike(term) | Student.admission_no.ilike(term)
        )

    students = db.scalars(query.order_by(Student.class_name, Student.roll_no, Student.full_name)).all()
    return [student_dict(db, s) for s in students]


@router.get("/students/{student_id}")
def get_student(student_id: int, db: DbSession, _: StaffUser):
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student_dict(db, student)


@router.post("/students", response_model=StudentCreateResponse, status_code=status.HTTP_201_CREATED)
def create_student(data: StudentCreate, db: DbSession, _: AdminUser):
    admission_no = _unique_admission_no(db, data.admission_no or "ADM")

    student = Student(
        admission_no=admission_no,
        full_name=data.full_name.strip(),
        class_name=data.class_name.strip(),
        roll_no=data.roll_no,
        gender=data.gender,
        dob=data.dob,
        parent_name=data.parent_name,
        parent_phone=data.parent_phone,
        parent_email=data.parent_email,
    )
    db.add(student)
    db.flush()

    credentials = _make_login(db, student, data.login_email, data.login_password)
    parent_credentials = _make_parent_login(db, student)

    db.commit()
    db.refresh(student)

    return {
        "student": student_dict(db, student),
        "credentials": credentials,
        "parent_credentials": parent_credentials,
    }


@router.put("/students/{student_id}", response_model=StudentOut)
def update_student(student_id: int, data: StudentUpdate, db: DbSession, _: AdminUser):
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    fields = data.model_dump(exclude_unset=True)
    login_email = fields.pop("login_email", None)
    login_password = fields.pop("login_password", None)

    for key, value in fields.items():
        setattr(student, key, value)

    if login_email or login_password:
        _make_login(db, student, login_email, login_password)

    if student.parent_email:
        _make_parent_login(db, student)

    db.commit()
    db.refresh(student)
    return student_dict(db, student)


@router.post("/students/{student_id}/parent-login")
def create_parent_login(student_id: int, db: DbSession, _: AdminUser):
    """Create or reset the parent login for a student."""
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    credentials = _make_parent_login(db, student, force_reset=True)
    if not credentials:
        raise HTTPException(
            status_code=400,
            detail="Add a parent email to this student first",
        )

    db.commit()
    return credentials


@router.delete("/students/{student_id}")
def deactivate_student(student_id: int, db: DbSession, _: AdminUser):
    """Soft delete: student is marked inactive (history stays safe)."""
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    student.is_active = False
    if student.user_id:
        user = db.get(User, student.user_id)
        if user:
            user.is_active = False

    db.commit()
    return {"ok": True, "detail": f"{student.full_name} deactivated"}


@router.post("/students/{student_id}/restore")
def restore_student(student_id: int, db: DbSession, _: AdminUser):
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    student.is_active = True
    if student.user_id:
        user = db.get(User, student.user_id)
        if user:
            user.is_active = True

    db.commit()
    return {"ok": True, "detail": f"{student.full_name} restored"}


# ---------------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------------
@router.post("/attendance", status_code=status.HTTP_201_CREATED)
def mark_attendance(data: AttendanceMark, db: DbSession, staff: StaffUser):
    saved = []
    for record in data.records:
        student = db.get(Student, record.student_id)
        if not student:
            continue

        existing = db.scalar(
            select(Attendance).where(
                Attendance.student_id == record.student_id,
                Attendance.day == data.day,
            )
        )

        if existing:
            existing.status = record.status
            existing.class_name = student.class_name
            existing.marked_by = staff.full_name
            saved.append(existing)
            continue

        row = Attendance(
            student_id=record.student_id,
            class_name=student.class_name,
            day=data.day,
            status=record.status,
            marked_by=staff.full_name,
        )
        db.add(row)
        saved.append(row)

    db.commit()
    return {"ok": True, "saved": len(saved)}


@router.get("/attendance")
def list_attendance(
    db: DbSession,
    _: StaffUser,
    class_name: Optional[str] = Query(default=None),
    day: Optional[date] = Query(default=None),
    student_id: Optional[int] = Query(default=None),
):
    query = (
        select(Attendance, Student.full_name)
        .join(Student, Student.id == Attendance.student_id)
    )
    if class_name:
        query = query.where(Attendance.class_name == class_name)
    if day:
        query = query.where(Attendance.day == day)
    if student_id:
        query = query.where(Attendance.student_id == student_id)

    rows = db.execute(query.order_by(Attendance.day.desc(), Student.full_name)).all()
    return [
        {
            "id": a.id,
            "student_id": a.student_id,
            "student_name": name,
            "class_name": a.class_name,
            "day": a.day,
            "status": a.status,
            "marked_by": a.marked_by,
        }
        for a, name in rows
    ]


# ---------------------------------------------------------------------------
# Fees
# ---------------------------------------------------------------------------
@router.get("/fees")
def list_fees(
    db: DbSession,
    _: StaffUser,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    student_id: Optional[int] = Query(default=None),
):
    query = select(FeeRecord, Student.full_name, Student.class_name).join(
        Student, Student.id == FeeRecord.student_id
    )
    if status_filter:
        query = query.where(FeeRecord.status == status_filter)
    if student_id:
        query = query.where(FeeRecord.student_id == student_id)

    rows = db.execute(query.order_by(FeeRecord.due_date.desc().nullslast(), FeeRecord.id.desc())).all()
    return [
        {
            "id": fee.id,
            "student_id": fee.student_id,
            "student_name": name,
            "class_name": cls,
            "title": fee.title,
            "amount": fee.amount,
            "due_date": fee.due_date,
            "status": fee.status,
            "paid_at": fee.paid_at,
            "created_at": fee.created_at,
        }
        for fee, name, cls in rows
    ]


@router.post("/fees", response_model=FeeOut, status_code=status.HTTP_201_CREATED)
def create_fee(data: FeeCreate, db: DbSession, _: AdminUser):
    student = db.get(Student, data.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    fee = FeeRecord(
        student_id=student.id,
        title=data.title.strip(),
        amount=data.amount,
        due_date=data.due_date,
    )
    db.add(fee)
    db.commit()
    db.refresh(fee)
    return {
        "id": fee.id,
        "student_id": fee.student_id,
        "student_name": student.full_name,
        "class_name": student.class_name,
        "title": fee.title,
        "amount": fee.amount,
        "due_date": fee.due_date,
        "status": fee.status,
        "paid_at": fee.paid_at,
        "created_at": fee.created_at,
    }


@router.put("/fees/{fee_id}")
def update_fee(fee_id: int, data: FeeUpdate, db: DbSession, _: AdminUser):
    fee = db.get(FeeRecord, fee_id)
    if not fee:
        raise HTTPException(status_code=404, detail="Fee record not found")

    fields = data.model_dump(exclude_unset=True)

    if "status" in fields and fields["status"] != fee.status:
        from datetime import datetime, timezone

        if fields["status"] == "paid":
            fee.paid_at = datetime.now(timezone.utc)
            fee.status = "paid"
        else:
            fee.paid_at = None
            fee.status = "unpaid"
        fields.pop("status")

    for key, value in fields.items():
        setattr(fee, key, value)

    db.commit()
    return {"ok": True, "detail": "Fee updated"}


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
@router.get("/results")
def list_results(
    db: DbSession,
    _: StaffUser,
    exam_name: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    student_id: Optional[int] = Query(default=None),
):
    query = select(ExamResult, Student.full_name, Student.class_name).join(
        Student, Student.id == ExamResult.student_id
    )
    if exam_name:
        query = query.where(ExamResult.exam_name == exam_name)
    if class_name:
        query = query.where(Student.class_name == class_name)
    if student_id:
        query = query.where(ExamResult.student_id == student_id)

    rows = db.execute(query.order_by(ExamResult.exam_name, Student.full_name, ExamResult.subject)).all()
    return [
        {
            "id": r.id,
            "student_id": r.student_id,
            "student_name": name,
            "class_name": cls,
            "exam_name": r.exam_name,
            "subject": r.subject,
            "marks_obtained": r.marks_obtained,
            "total_marks": r.total_marks,
            "created_at": r.created_at,
        }
        for r, name, cls in rows
    ]


@router.post("/results", status_code=status.HTTP_201_CREATED)
def create_result(data: ResultCreate, db: DbSession, _: StaffUser):
    student = db.get(Student, data.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    if data.marks_obtained > data.total_marks:
        raise HTTPException(status_code=400, detail="Marks cannot exceed total marks")

    db.add(
        ExamResult(
            student_id=student.id,
            exam_name=data.exam_name.strip(),
            subject=data.subject.strip(),
            marks_obtained=data.marks_obtained,
            total_marks=data.total_marks,
        )
    )
    db.commit()
    return {"ok": True, "detail": f"Marks saved for {student.full_name}"}


@router.post("/results/bulk")
def create_results_bulk(data: ResultBulk, db: DbSession, _: StaffUser):
    saved = 0
    for item in data.marks:
        if item.marks_obtained > data.total_marks:
            continue
        db.add(
            ExamResult(
                student_id=item.student_id,
                exam_name=data.exam_name.strip(),
                subject=data.subject.strip(),
                marks_obtained=item.marks_obtained,
                total_marks=data.total_marks,
            )
        )
        saved += 1

    db.commit()
    return {"ok": True, "saved": saved}


# ---------------------------------------------------------------------------
# Student portal (student logs in and sees own data)
# ---------------------------------------------------------------------------
@router.get("/portal/me")
def portal_me(user: CurrentUser, db: DbSession):
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Student access required")

    student = db.scalar(select(Student).where(Student.user_id == user.id))
    if not student:
        raise HTTPException(status_code=404, detail="No student profile linked to this account")

    attendance_rows = db.scalars(
        select(Attendance).where(Attendance.student_id == student.id).order_by(Attendance.day.desc())
    ).all()

    present = sum(1 for a in attendance_rows if a.status == "present")
    absent = sum(1 for a in attendance_rows if a.status == "absent")
    leave_count = sum(1 for a in attendance_rows if a.status == "leave")
    total = len(attendance_rows)
    percent = round((present / total) * 100, 1) if total else 0.0

    fees = db.scalars(
        select(FeeRecord).where(FeeRecord.student_id == student.id).order_by(FeeRecord.id.desc())
    ).all()

    results = db.scalars(
        select(ExamResult)
        .where(ExamResult.student_id == student.id)
        .order_by(ExamResult.exam_name, ExamResult.subject)
    ).all()

    notices = db.scalars(
        select(Notice).where(Notice.is_active.is_(True)).order_by(Notice.created_at.desc()).limit(10)
    ).all()

    notes = db.scalars(
        select(TeacherNote)
        .where(
            (TeacherNote.student_id == student.id)
            | (
                TeacherNote.student_id.is_(None)
                & (TeacherNote.class_name == student.class_name)
            )
        )
        .order_by(TeacherNote.created_at.desc())
        .limit(30)
    ).all()

    return {
        "profile": student_dict(db, student),
        "attendance": {
            "present": present,
            "absent": absent,
            "leave": leave_count,
            "total": total,
            "percent": percent,
            "recent": [
                {"day": a.day, "status": a.status} for a in attendance_rows[:15]
            ],
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
                "percent": round((r.marks_obtained / r.total_marks) * 100, 1) if r.total_marks else 0,
            }
            for r in results
        ],
        "notices": [
            {"id": n.id, "title": n.title, "message": n.message, "created_at": n.created_at}
            for n in notices
        ],
        "notes": [
            {
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "category": n.category,
                "teacher_name": n.teacher_name,
                "created_at": n.created_at,
            }
            for n in notes
        ],
    }
