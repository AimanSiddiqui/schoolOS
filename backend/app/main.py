from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.academics.routes import router as academics_router
from app.core.config import get_settings
from app.identity.routes import router as identity_router
from app.students.routes import router as students_router

settings = get_settings()

app = FastAPI(
    title="SchoolOS API",
    version="0.1.0",
    description="Local API foundation for the SchoolOS MVP.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", tags=["system"])
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "schoolos-api"}


@app.get("/api/v1/health", tags=["system"])
def api_health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "schoolos-api",
        "environment": settings.environment,
    }


app.include_router(identity_router)
app.include_router(academics_router)
app.include_router(students_router)
