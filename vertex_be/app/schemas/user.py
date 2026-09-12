from pydantic import BaseModel, EmailStr, Field

class UserBase(BaseModel):
    email: EmailStr = Field(..., example="user@example.com")
    full_name: str | None = Field(None, example="John Doe")

class UserCreate(UserBase):
    password: str = Field(..., min_length=6, example="strongpassword")

class UserRead(UserBase):
    id: int
    is_active: bool = True
    is_verified: bool = False

    class Config:
        orm_mode = True
