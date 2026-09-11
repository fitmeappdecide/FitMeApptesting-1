from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str
    message: str
    message_hi: str


class PaginatedQuery(BaseModel):
    page: int = 1
    limit: int = 20

