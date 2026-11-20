"""Sign-in addresses are case-insensitive (upstream's DEF-001, 2026-11-10).

"SARAH@agency.com" and "sarah@agency.com" are one mailbox, yet an exact
comparison let the second create another account, and only the exact
spelling could sign in. So:

- a new account's address is stored lowercased, without surrounding space;
- every lookup of an account by address ignores case.

Addresses already stored keep their spelling. Should two accounts that
differ only in case exist from before, the exact spelling wins at sign-in,
so neither user is locked out by this change.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.models.identity import User


def account_email(value: str) -> str:
    """The address as a new account stores it."""
    return value.strip().lower()


def same_email(column, value: str) -> ColumnElement[bool]:
    """WHERE the column holds this address, in any case."""
    return func.lower(column) == account_email(value)


def email_taken(db: Session, email: str, *, other_than: str | None = None) -> bool:
    """An account (other than this one) already uses the address."""
    query = select(User.id).where(same_email(User.email, email))
    if other_than is not None:
        query = query.where(User.id != other_than)
    return db.scalar(query.limit(1)) is not None


def find_account(db: Session, email: str) -> User | None:
    """The account for an address, the exact spelling first."""
    return db.scalar(
        select(User).where(same_email(User.email, email)).order_by((User.email == email.strip()).desc(), User.created_at).limit(1)
    )
