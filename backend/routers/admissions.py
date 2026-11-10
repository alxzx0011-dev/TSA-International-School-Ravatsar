from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from deps import AdminUser, AdmissionsUser, DbSession, require_admissions
from ratelimit import rate_limit
from model import Admission, Student
from routers.management import (
    _make_login,
    _make_parent_login,
    _unique_admission_no,
    student_dict,
)
from schemas import AdmissionCreate, AdmissionOut, AdmissionStatusUpdate

router = APIRouter(prefix="/api/admissions", tags=["Admissions"])


@router.post(
    "",
    response_model=AdmissionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("admission", 5, 600))],
)
def create_admission(data: AdmissionCreate, db: DbSession):
    admission = Admission(**data.model_dump())

    db.add(admission)
    db.commit()
    db.refresh(admission)

    return admission


@router.get(
    "",
    response_model=list[AdmissionOut],
    dependencies=[Depends(require_admissions)],
)
def list_admissions(
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(Admission)
        .order_by(Admission.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    if status_filter:
        stmt = stmt.where(Admission.status == status_filter)

    return db.scalars(stmt).all()


@router.patch("/{admission_id}", response_model=AdmissionOut)
def update_admission(
    admission_id: int,
    data: AdmissionStatusUpdate,
    db: DbSession,
    _: AdmissionsUser,
):
    admission = db.get(Admission, admission_id)

    if admission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admission not found",
        )

    admission.status = data.status
    db.commit()
    db.refresh(admission)

    return admission


@router.delete("/{admission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admission(admission_id: int, db: DbSession, _: AdminUser):
    admission = db.get(Admission, admission_id)

    if admission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admission not found",
        )

    db.delete(admission)
    db.commit()


@router.post("/{admission_id}/convert", status_code=status.HTTP_201_CREATED)
def convert_admission(admission_id: int, db: DbSession, _: AdminUser):
    """Create a student (with logins) from an approved application."""
    admission = db.get(Admission, admission_id)
    if admission is None:
        raise HTTPException(status_code=404, detail="Admission not found")

    if admission.status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Approve this application before converting it to a student",
        )

    email = (admission.parent_email or "").strip().lower()
    duplicate_query = select(Student).where(
        func.lower(Student.full_name) == admission.student_name.strip().lower(),
        Student.class_name == admission.class_name,
    )
    if email:
        duplicate_query = duplicate_query.where(
            func.lower(Student.parent_email) == email
        )

    if db.scalar(duplicate_query):
        raise HTTPException(
            status_code=409,
            detail="A student with this name and class already exists",
        )

    student = Student(
        admission_no=_unique_admission_no(db, f"ADM-{admission.id}"),
        full_name=admission.student_name.strip(),
        class_name=admission.class_name.strip(),
        parent_name=admission.parent_name,
        parent_phone=admission.phone,
        parent_email=email or None,
    )
    db.add(student)
    db.flush()

    credentials = _make_login(db, student, None, None)
    parent_credentials = _make_parent_login(db, student)

    db.commit()
    db.refresh(student)

    return {
        "student": student_dict(db, student),
        "credentials": credentials,
        "parent_credentials": parent_credentials,
    }
