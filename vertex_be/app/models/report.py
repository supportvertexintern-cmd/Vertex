from sqlalchemy import Column, String, Integer, Date, Enum, ForeignKey, Text, JSON, Boolean
from sqlalchemy.orm import relationship
import enum

from app.models.base import BaseModel

class ReportType(str, enum.Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"

class ReportStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    REVIEWED = "reviewed"
    APPROVED = "approved"
    REJECTED = "rejected"

class Report(BaseModel):
    __tablename__ = "report"
    
    # Basic Information
    title = Column(String(255), nullable=False)
    report_type = Column(Enum(ReportType), nullable=False)
    report_date = Column(Date, nullable=False)
    period_start = Column(Date)
    period_end = Column(Date)
    
    # Status
    status = Column(Enum(ReportStatus), default=ReportStatus.DRAFT)
    
    # KPI Metrics (stored as JSON for flexibility)
    kpi_metrics = Column(JSON, default=dict)  # {metric_name: {target: X, actual: Y, variance: Z, comment: ""}}
    
    # Candidate Activity
    candidate_activity = Column(JSON, default=list)  # List of {candidate_id: X, activity: "", outcome: ""}
    
    # Issues & Blockers
    issues_blockers = Column(JSON, default=list)  # List of {issue: "", impact: "", resolution: ""}
    
    # Key Achievements
    key_achievements = Column(Text)
    
    # Tomorrow's Priority
    tomorrow_priority = Column(Text)
    
    # Declaration
    declaration_accepted = Column(Boolean, default=False)
    
    # Relationships
    recruiter_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    recruiter = relationship("User", back_populates="reports")
    
    candidate_id = Column(Integer, ForeignKey("candidate.id"))
    candidate = relationship("Candidate", back_populates="reports")
    
    # Supervisor Review
    supervisor_notes = Column(Text)
    reviewed_by = Column(Integer, ForeignKey("user.id"))
    reviewed_at = Column(Date)