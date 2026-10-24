from fastapi import APIRouter
from pydantic import BaseModel

from app.core.api import Data
from app.core.auth import CurrentUser
from app.models.enums import Role

router = APIRouter()


class Me(BaseModel):
    id: str
    email: str
    role: Role


@router.get("/me")
def me(user: CurrentUser) -> Data[Me]:
    """The signed-in caller, from the database (as Next.js's /api/auth/me)."""
    return Data(data=Me(id=user.user_id, email=user.email, role=user.role))
