from sqlalchemy import Column, String, Integer, Date, Enum, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
import enum

from app.models.base import BaseModel

class ExceptionType(str, enum.Enum):
    CANDIDATE_ELIGIBILITY = "candidate_eligibility_screening"
    CAMPAIGN_CRM = "campaign_crm_issue"
    OPERATIONAL = "operational"
    COMPLIANCE = "compliance"
    FINANCIAL = "financial"
    OTHER = "other"

class ExceptionStatus(str, enum.Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    DECIDED = "decided"
    CLOSED = "closed"

class ExceptionLevel(str, enum.Enum):
    LEVEL_1 = "level_1"  # Country Supervisor
    LEVEL_2 = "level_2"  # In-House Supervisor
    LEVEL_3 = "level_3"  # Management

class Exception(BaseModel):
    __tablename__ = "exception"
    
    # Reference
    reference = Column(String(50), unique=True, index=True, nullable=False)
    
    # Type & Classification
    exception_type = Column(Enum(ExceptionType), nullable=False)
    level = Column(Enum(ExceptionLevel), default=ExceptionLevel.LEVEL_1)
    
    # CRM Reference
    crm_ref = Column(String(100))
    
    # Issue Details
    issue_statement = Column(Text, nullable=False)
    immediate_impact = Column(Text, nullable=False)
    actions_taken = Column(Text)
    root_cause = Column(Text)
    options_considered = Column(Text)
    recommendation = Column(Text)
    decision_required = Column(Text, nullable=False)
    
    # Target Date
    target_date = Column(Date)
    
    # Corrective Actions (stored as JSON array)
    corrective_actions = Column(JSON, default=list)  # List of {description: "", completed: bool, completed_at: date}
    
    # Status
    status = Column(Enum(ExceptionStatus), default=ExceptionStatus.OPEN)
    
    # Resolution
    resolution = Column(Text)
    resolved_by = Column(Integer, ForeignKey("user.id"))
    resolved_at = Column(Date)
    
    # Relationships
    raised_by_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    raised_by = relationship("User", back_populates="exceptions", foreign_keys=[raised_by_id])
    
    candidate_id = Column(Integer, ForeignKey("candidate.id"))
    candidate = relationship("Candidate")
    
    # Escalation chain
    escalated_to = Column(Integer, ForeignKey("user.id"))
    escalated_by = relationship("User", foreign_keys=[escalated_to])