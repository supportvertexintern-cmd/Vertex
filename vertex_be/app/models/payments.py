from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, pk
from app.models.enums import PaymentStatus
from app.models.identity import User
from app.models.jobs import Job


class Payment(Base):
    __tablename__ = "Payment"

    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(fk("Job.id", "CASCADE"), index=True)
    amount: Mapped[float]
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    payment_method: Mapped[str]  # "stripe" | "paypal"
    payment_status: Mapped[PaymentStatus] = enum_col(PaymentStatus, default=PaymentStatus.pending)
    transaction_id: Mapped[str | None] = mapped_column(unique=True)
    created_at: Mapped[datetime] = created_at_col()

    user: Mapped[User] = relationship()
    job: Mapped[Job] = relationship()


class ConsultationBooking(Base):
    """Paid advisory consultation from the public landing page. Only ever
    created by the Stripe webhook once the charge is confirmed."""

    __tablename__ = "ConsultationBooking"

    id: Mapped[str] = pk()
    full_name: Mapped[str | None]
    email: Mapped[str]
    phone: Mapped[str | None]
    amount: Mapped[float]
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    status: Mapped[str] = mapped_column(default="paid", server_default="paid")
    stripe_checkout_session_id: Mapped[str] = mapped_column(unique=True)
    stripe_payment_intent_id: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col(index=True)
