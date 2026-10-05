from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="local", validation_alias="SCHOOLOS_ENVIRONMENT")
    database_url: str = Field(
        default="postgresql+psycopg://schoolos:schoolos_dev_password@localhost:5432/schoolos",
        validation_alias="DATABASE_URL",
    )
    cors_origins_raw: str = Field(
        default="http://localhost:3000",
        validation_alias="SCHOOLOS_CORS_ORIGINS",
    )
    session_cookie_name: str = Field(
        default="schoolos_session",
        validation_alias="SESSION_COOKIE_NAME",
    )
    session_days: int = Field(default=30, validation_alias="SESSION_DAYS")
    secure_cookies: bool = Field(default=False, validation_alias="SECURE_COOKIES")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
