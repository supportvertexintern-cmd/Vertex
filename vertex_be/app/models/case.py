from sqlalchemy import Column, String, Integer, Date, Enum, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
import enum

from app.models.base import BaseModel

class CaseStatus(str, enum.Enum):
    ACTIVE = "active"
    PENDING = "pending"
    CLOSED = "closed"
    ESCALATED = "escalated"

class CasePriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class Case(BaseModel):
    __tablename__ = "case"
    
    # Basic Information
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    case_number = Column(String(50), unique=True, index=True)
    
    # Classification
    status = Column(Enum(CaseStatus), default=CaseStatus.ACTIVE)
    priority = Column(Enum(CasePriority), default=CasePriority.MEDIUM)
    category = Column(String(100))  # e.g., "Documentation", "Visa", "Compliance"
    
    # Dates
    opened_date = Column(Date, nullable=False)
    due_date = Column(Date)
    closed_date = Column(Date)
    
    # Details
    issue_details = Column(Text)
    required_actions = Column(Text)
    notes = Column(Text)
    
    # Attachments (JSON array of file paths)
    attachments = Column(JSON, default=list)
    
    # Relationships
    candidate_id = Column(Integer, ForeignKey("candidate.id"), nullable=False)
    candidate = relationship("Candidate", back_populates="cases")
    
    assigned_to_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    assigned_to = relationship("User", back_populates="cases", foreign_keys=[assigned_to_id])
    
    # Supervisor assignment
    assigned_by_id = Column(Integer, ForeignKey("user.id"))
    assigned_by = relationship("User", foreign_keys=[assigned_by_id])
    
    # Progress tracking
    progress_percentage = Column(Integer, default=0)
    last_updated_by = Column(Integer, ForeignKey("user.id"))
    last_updated_by_user = relationship("User", foreign_keys=[last_updated_by])