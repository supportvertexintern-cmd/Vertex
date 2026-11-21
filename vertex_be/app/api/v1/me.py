from fastapi import APIRouter
from pydantic import BaseModel

from app.core.api import Data
from app.api.deps import DbSession
from app.core.auth import CurrentUser
from app.core.permissions import Permission, role_permissions
from app.models.enums import Role

router = APIRouter()


class Me(BaseModel):
    id: str
    email: str
    role: Role
    # What the role holds (role management): for showing the pages; each route checks again.
    permissions: list[Permission]


@router.get("/me")
def me(user: CurrentUser, db: DbSession) -> Data[Me]:
    """The signed-in caller, from the database (as Next.js's /api/auth/me)."""
    held = role_permissions(db, user.role)
    return Data(data=Me(id=user.user_id, email=user.email, role=user.role, permissions=[p for p in Permission if p in held]))
