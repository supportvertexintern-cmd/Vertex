from sqlalchemy import Column, String, Boolean, Enum, Text
from sqlalchemy.orm import relationship
import enum

from app.models.base import BaseModel

class UserRole(str, enum.Enum):
    CANDIDATE = "candidate"
    REGIONAL_RECRUITER = "regional_recruiter"
    COUNTRY_SUPERVISOR = "country_supervisor"
    INHOUSE_SUPERVISOR = "inhouse_supervisor"
    MANAGEMENT = "management"
    HR = "hr"
    OPERATIONS = "operations"
    FINANCE = "finance"
    MARKETING = "marketing"
    ADMIN = "admin"
    PARTNER = "partner"

class User(BaseModel):
    __tablename__ = "user"
    
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255))
    phone = Column(String(50))
    role = Column(Enum(UserRole), nullable=False)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    
    # Relationships
    candidates = relationship("Candidate", back_populates="recruiter", foreign_keys="Candidate.recruiter_id")
    reports = relationship("Report", back_populates="recruiter")
    exceptions = relationship("Exception", back_populates="raised_by")
    cases = relationship("Case", back_populates="assigned_to")