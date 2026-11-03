from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from deps import AdminUser, AdmissionsUser, DbSession, require_admissions
from ratelimit import rate_limit
from model import Admission
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
