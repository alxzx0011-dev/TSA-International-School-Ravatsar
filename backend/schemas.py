from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def clean_email(value: str) -> str:
    value = value.strip().lower()

    if "@" not in value or "." not in value.rsplit("@", 1)[-1]:
        raise ValueError("Enter a valid email address")

    return value


# ---------------------------------------------------------------------------
# Auth / Users
# ---------------------------------------------------------------------------
class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return clean_email(value)


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ---------------------------------------------------------------------------
# Admissions
# ---------------------------------------------------------------------------
class AdmissionCreate(BaseModel):
    parent_name: str = Field(min_length=2, max_length=150)
    student_name: str = Field(min_length=2, max_length=150)
    class_name: str = Field(min_length=1, max_length=50)
    parent_email: str = Field(min_length=5, max_length=255)
    phone: str = Field(min_length=7, max_length=30)
    message: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("parent_email")
    @classmethod
    def validate_parent_email(cls, value: str) -> str:
        return clean_email(value)


class AdmissionStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = value.strip().lower()
        allowed = {"new", "reviewing", "approved", "rejected"}

        if value not in allowed:
            raise ValueError(f"status must be one of: {', '.join(sorted(allowed))}")

        return value


class AdmissionOut(AdmissionCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Contact messages
# ---------------------------------------------------------------------------
class ContactCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: str = Field(min_length=5, max_length=255)
    phone: str = Field(min_length=7, max_length=30)
    subject: str = Field(min_length=2, max_length=150)
    message: str = Field(min_length=5, max_length=3000)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return clean_email(value)


class ContactOut(ContactCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_read: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------
class NewsBase(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    summary: Optional[str] = Field(default=None, max_length=500)
    content: str = Field(min_length=1, max_length=20000)
    image_url: Optional[str] = Field(default=None, max_length=500)
    is_published: bool = True


class NewsCreate(NewsBase):
    pass


class NewsUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    summary: Optional[str] = Field(default=None, max_length=500)
    content: Optional[str] = Field(default=None, min_length=1, max_length=20000)
    image_url: Optional[str] = Field(default=None, max_length=500)
    is_published: Optional[bool] = None


class NewsOut(NewsBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Notices
# ---------------------------------------------------------------------------
class NoticeCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    message: str = Field(min_length=2, max_length=5000)
    is_active: bool = True


class NoticeUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    message: Optional[str] = Field(default=None, min_length=2, max_length=5000)
    is_active: Optional[bool] = None


class NoticeOut(NoticeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------
class EventCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    event_date: date
    location: Optional[str] = Field(default=None, max_length=200)
    image_url: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = True


class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    event_date: Optional[date] = None
    location: Optional[str] = Field(default=None, max_length=200)
    image_url: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class EventOut(EventCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Gallery
# ---------------------------------------------------------------------------
class GalleryCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="General", max_length=80)
    image_url: str = Field(min_length=3, max_length=500)
    sort_order: int = 0
    is_active: bool = True


class GalleryUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, max_length=80)
    image_url: Optional[str] = Field(default=None, min_length=3, max_length=500)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class GalleryOut(GalleryCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Faculty
# ---------------------------------------------------------------------------
class FacultyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    designation: str = Field(min_length=2, max_length=150)
    subject: Optional[str] = Field(default=None, max_length=150)
    bio: Optional[str] = Field(default=None, max_length=3000)
    image_url: Optional[str] = Field(default=None, max_length=500)
    sort_order: int = 0
    is_active: bool = True


class FacultyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    designation: Optional[str] = Field(default=None, min_length=2, max_length=150)
    subject: Optional[str] = Field(default=None, max_length=150)
    bio: Optional[str] = Field(default=None, max_length=3000)
    image_url: Optional[str] = Field(default=None, max_length=500)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class FacultyOut(FacultyCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int


# ---------------------------------------------------------------------------
# Site settings
# ---------------------------------------------------------------------------
class SettingItem(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    value: Optional[str] = Field(default=None, max_length=10000)


# ---------------------------------------------------------------------------
# School management (students, attendance, fees, results)
# ---------------------------------------------------------------------------
class StudentBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    class_name: str = Field(min_length=1, max_length=50)
    roll_no: Optional[str] = Field(default=None, max_length=20)
    gender: Optional[str] = Field(default=None, max_length=20)
    dob: Optional[date] = None
    parent_name: Optional[str] = Field(default=None, max_length=150)
    parent_phone: Optional[str] = Field(default=None, max_length=30)
    parent_email: Optional[str] = Field(default=None, max_length=255)


class StudentCreate(StudentBase):
    admission_no: Optional[str] = Field(default=None, max_length=30)
    login_email: Optional[str] = Field(default=None, max_length=255)
    login_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class StudentUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    class_name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    roll_no: Optional[str] = Field(default=None, max_length=20)
    gender: Optional[str] = Field(default=None, max_length=20)
    dob: Optional[date] = None
    parent_name: Optional[str] = Field(default=None, max_length=150)
    parent_phone: Optional[str] = Field(default=None, max_length=30)
    parent_email: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None
    login_email: Optional[str] = Field(default=None, max_length=255)
    login_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class StudentOut(StudentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    admission_no: str
    is_active: bool
    login_email: Optional[str] = None
    parent_login_email: Optional[str] = None
    created_at: Optional[datetime] = None


class StudentCreateResponse(BaseModel):
    student: StudentOut
    credentials: Optional[dict] = None
    parent_credentials: Optional[dict] = None


class AttendanceRecord(BaseModel):
    student_id: int
    status: str = Field(default="present")

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"present", "absent", "leave"}:
            raise ValueError("status must be present, absent or leave")
        return value


class AttendanceMark(BaseModel):
    class_name: str = Field(min_length=1, max_length=50)
    day: date
    records: list[AttendanceRecord]


class AttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: int
    class_name: str
    day: date
    status: str


class FeeCreate(BaseModel):
    student_id: int
    title: str = Field(min_length=2, max_length=200)
    amount: float = Field(gt=0)
    due_date: Optional[date] = None


class FeeUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    amount: Optional[float] = Field(default=None, gt=0)
    due_date: Optional[date] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, value):
        if value is None:
            return value
        value = value.strip().lower()
        if value not in {"unpaid", "paid"}:
            raise ValueError("status must be unpaid or paid")
        return value


class FeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: int
    title: str
    amount: float
    due_date: Optional[date] = None
    status: str
    paid_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    student_name: Optional[str] = None
    class_name: Optional[str] = None


class ResultCreate(BaseModel):
    student_id: int
    exam_name: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=120)
    marks_obtained: float = Field(ge=0)
    total_marks: float = Field(default=100, gt=0)


class ResultMark(BaseModel):
    student_id: int
    marks_obtained: float = Field(ge=0)


class ResultBulk(BaseModel):
    exam_name: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=120)
    total_marks: float = Field(default=100, gt=0)
    marks: list[ResultMark]


class ResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: int
    exam_name: str
    subject: str
    marks_obtained: float
    total_marks: float
    created_at: Optional[datetime] = None
    student_name: Optional[str] = None
    class_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Teacher notes / parent complaints
# ---------------------------------------------------------------------------
class TeacherNoteCreate(BaseModel):
    student_id: Optional[int] = None
    class_name: Optional[str] = Field(default=None, max_length=50)
    title: str = Field(min_length=2, max_length=200)
    message: str = Field(min_length=2, max_length=5000)
    category: str = Field(default="note", max_length=30)
    visible_to_parent: bool = True

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"note", "homework", "remark"}:
            raise ValueError("category must be note, homework or remark")
        return value

    @model_validator(mode="after")
    def require_target(self):
        if not self.student_id and not (self.class_name or "").strip():
            raise ValueError("Choose a student or a class")
        return self


class TeacherNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: Optional[int] = None
    class_name: Optional[str] = None
    teacher_name: str
    title: str
    message: str
    category: str
    visible_to_parent: bool
    created_at: Optional[datetime] = None
    student_name: Optional[str] = None


class ComplaintCreate(BaseModel):
    student_id: int
    subject: str = Field(min_length=2, max_length=200)
    message: str = Field(min_length=2, max_length=5000)


class ComplaintRespond(BaseModel):
    response: str = Field(min_length=2, max_length=5000)
    status: str = Field(default="answered", max_length=20)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"answered", "closed", "open"}:
            raise ValueError("status must be open, answered or closed")
        return value


class ComplaintOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: int
    parent_id: int
    parent_name: str
    subject: str
    message: str
    status: str
    response: Optional[str] = None
    responded_by: Optional[str] = None
    responded_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    student_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Admin user management
# ---------------------------------------------------------------------------
class ManagedUserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="teacher", max_length=20)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return clean_email(value)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"admin", "owner", "teacher", "admissions", "parent", "student"}:
            raise ValueError("Invalid role")
        return value


class ManagedUserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    role: Optional[str] = Field(default=None, max_length=20)
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value):
        if value is None:
            return value
        value = value.strip().lower()
        if value not in {"admin", "owner", "teacher", "admissions", "parent", "student"}:
            raise ValueError("Invalid role")
        return value


class ManagedUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Timetable
# ---------------------------------------------------------------------------
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


class TimetableSlotIn(BaseModel):
    class_name: str = Field(min_length=1, max_length=50)
    day_of_week: str = Field(min_length=3, max_length=10)
    period: int = Field(ge=1, le=12)
    subject: str = Field(min_length=1, max_length=120)
    teacher_name: Optional[str] = Field(default=None, max_length=150)
    room: Optional[str] = Field(default=None, max_length=50)

    @field_validator("day_of_week")
    @classmethod
    def validate_day(cls, value: str) -> str:
        value = value.strip().capitalize()
        if value not in DAY_NAMES:
            raise ValueError(f"day must be one of: {', '.join(DAY_NAMES)}")
        return value


class TimetableSlotOut(TimetableSlotIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


# ---------------------------------------------------------------------------
# Homework
# ---------------------------------------------------------------------------
class HomeworkSubmit(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class HomeworkCheck(BaseModel):
    remark: Optional[str] = Field(default=None, max_length=2000)
    status: str = Field(default="checked", max_length=20)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"submitted", "checked"}:
            raise ValueError("status must be submitted or checked")
        return value


# ---------------------------------------------------------------------------
# Leave applications
# ---------------------------------------------------------------------------
class LeaveCreate(BaseModel):
    student_id: int
    from_date: date
    to_date: date
    reason: str = Field(min_length=3, max_length=2000)

    @model_validator(mode="after")
    def check_dates(self):
        if self.to_date < self.from_date:
            raise ValueError("to_date cannot be before from_date")
        return self


class LeaveDecision(BaseModel):
    status: str = Field(max_length=20)
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"approved", "rejected"}:
            raise ValueError("status must be approved or rejected")
        return value


# ---------------------------------------------------------------------------
# Self-service password change
# ---------------------------------------------------------------------------
class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
