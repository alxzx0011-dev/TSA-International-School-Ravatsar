from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="student")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Admission(Base):
    __tablename__ = "admissions"

    id = Column(Integer, primary_key=True, index=True)
    parent_name = Column(String(150), nullable=False)
    student_name = Column(String(150), nullable=False)
    class_name = Column(String(50), nullable=False)
    parent_email = Column(String(255), nullable=False, index=True)
    phone = Column(String(30), nullable=False)
    message = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="new", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ContactMessage(Base):
    __tablename__ = "contact_messages"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    phone = Column(String(30), nullable=False)
    subject = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class News(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    image_url = Column(String(500), nullable=True)
    is_published = Column(Boolean, nullable=False, default=True, index=True)
    published_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Notice(Base):
    __tablename__ = "notices"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    event_date = Column(Date, nullable=False)
    location = Column(String(200), nullable=True)
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GalleryItem(Base):
    __tablename__ = "gallery_items"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    category = Column(String(80), nullable=False, default="General")
    image_url = Column(String(500), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Faculty(Base):
    __tablename__ = "faculty"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    designation = Column(String(150), nullable=False)
    subject = Column(String(150), nullable=True)
    bio = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)


class SiteSetting(Base):
    __tablename__ = "site_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)


# ---------------------------------------------------------------------------
# School management system
# ---------------------------------------------------------------------------
class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    admission_no = Column(String(30), unique=True, nullable=False, index=True)
    full_name = Column(String(150), nullable=False)
    class_name = Column(String(50), nullable=False, index=True)
    roll_no = Column(String(20), nullable=True)
    gender = Column(String(20), nullable=True)
    dob = Column(Date, nullable=True)
    parent_name = Column(String(150), nullable=True)
    parent_phone = Column(String(30), nullable=True)
    parent_email = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("student_id", "day", name="uq_attendance_student_day"),)

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    class_name = Column(String(50), nullable=False, index=True)
    day = Column(Date, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="present")  # present|absent|leave
    marked_by = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FeeRecord(Base):
    __tablename__ = "fee_records"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    amount = Column(Float, nullable=False)
    due_date = Column(Date, nullable=True)
    status = Column(String(20), nullable=False, default="unpaid", index=True)  # unpaid|paid
    paid_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ExamResult(Base):
    __tablename__ = "exam_results"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    exam_name = Column(String(120), nullable=False, index=True)
    subject = Column(String(120), nullable=False)
    marks_obtained = Column(Float, nullable=False)
    total_marks = Column(Float, nullable=False, default=100)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TeacherNote(Base):
    """A note, homework task or remark posted by a teacher for a student/class."""

    __tablename__ = "teacher_notes"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=True, index=True)
    class_name = Column(String(50), nullable=True, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    teacher_name = Column(String(150), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    category = Column(String(30), nullable=False, default="note")  # note|homework|remark
    visible_to_parent = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ParentComplaint(Base):
    """A complaint raised by a parent, answered by a teacher."""

    __tablename__ = "parent_complaints"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    parent_name = Column(String(150), nullable=False)
    subject = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="open", index=True)  # open|answered|closed
    response = Column(Text, nullable=True)
    responded_by = Column(String(150), nullable=True)
    responded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ParentLink(Base):
    """Links a parent login to one or more students."""

    __tablename__ = "parent_links"
    __table_args__ = (
        UniqueConstraint("parent_user_id", "student_id", name="uq_parent_link"),
    )

    id = Column(Integer, primary_key=True, index=True)
    parent_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Timetable, homework submissions, leave applications
# ---------------------------------------------------------------------------
class TimetableSlot(Base):
    """One subject in a class timetable (class + day + period is unique)."""

    __tablename__ = "timetable_slots"
    __table_args__ = (
        UniqueConstraint(
            "class_name", "day_of_week", "period", name="uq_timetable_slot"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    class_name = Column(String(50), nullable=False, index=True)
    day_of_week = Column(String(10), nullable=False, index=True)  # Monday..Saturday
    period = Column(Integer, nullable=False)
    subject = Column(String(120), nullable=False)
    teacher_name = Column(String(150), nullable=True)
    room = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class HomeworkSubmission(Base):
    """A student's answer for a homework note posted by a teacher."""

    __tablename__ = "homework_submissions"
    __table_args__ = (
        UniqueConstraint("note_id", "student_id", name="uq_homework_submission"),
    )

    id = Column(Integer, primary_key=True, index=True)
    note_id = Column(
        Integer, ForeignKey("teacher_notes.id"), nullable=False, index=True
    )
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="submitted")  # submitted|checked
    remark = Column(Text, nullable=True)
    checked_by = Column(String(150), nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    checked_at = Column(DateTime(timezone=True), nullable=True)


class LeaveRequest(Base):
    """A leave application sent by a parent for one child."""

    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending|approved|rejected
    decided_by = Column(String(150), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
