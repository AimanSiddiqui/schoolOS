FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
RUN python -m pip install --upgrade pip && python -m pip install -e .

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

FROM base AS test

RUN python -m pip install -e ".[dev]"
COPY tests ./tests
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider"]

FROM base AS runtime

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
