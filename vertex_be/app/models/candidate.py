from sqlalchemy import Column, String, Integer, Date, Enum, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
import enum

from app.models.base import BaseModel

class Gender(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"

class MaritalStatus(str, enum.Enum):
    SINGLE = "single"
    MARRIED = "married"
    DIVORCED = "divorced"
    WIDOWED = "widowed"

class CandidateStatus(str, enum.Enum):
    NEW = "new"
    SCREENING = "screening"
    INTERVIEW = "interview"
    OFFER = "offer"
    HIRED = "hired"
    REJECTED = "rejected"
    ON_HOLD = "on_hold"

class Candidate(BaseModel):
    __tablename__ = "candidate"
    
    # Personal Information
    full_name = Column(String(255), nullable=False)
    date_of_birth = Column(Date)
    gender = Column(Enum(Gender))
    nationality = Column(String(100))
    passport_number = Column(String(50), unique=True)
    
    # Contact Information
    email = Column(String(255), unique=True, index=True)
    phone = Column(String(50))
    address = Column(Text)
    city = Column(String(100))
    country = Column(String(100))
    
    # Professional Information
    current_job_title = Column(String(255))
    years_of_experience = Column(Integer)
    education_level = Column(String(100))
    skills = Column(Text)  # JSON or comma-separated
    
    # Recruitment Information
    status = Column(Enum(CandidateStatus), default=CandidateStatus.NEW)
    opportunity = Column(String(255))  # Job position applying for
    expected_salary = Column(Integer)
    notice_period = Column(Integer)  # Days
    
    # Documents
    cv_path = Column(String(500))
    passport_copy_path = Column(String(500))
    other_documents = Column(Text)  # JSON array of document paths
    
    # Relationships
    recruiter_id = Column(Integer, ForeignKey("user.id"))
    recruiter = relationship("User", back_populates="candidates", foreign_keys=[recruiter_id])
    
    reports = relationship("Report", back_populates="candidate")
    cases = relationship("Case", back_populates="candidate")
    
    # Flags
    is_available = Column(Boolean, default=True)
    notes = Column(Text)