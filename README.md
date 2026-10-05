# SchoolOS

SchoolOS is a local-first school-management MVP focused on attendance, follow-up actions, student timelines, and approved guardian communication.

## Current Status

Milestones 0 through 2 are complete, and Milestone 3 has the first academics/directory slice:

- FastAPI backend with health endpoints.
- Next.js frontend shell with a live backend health check.
- PostgreSQL schema migration for the first tenant/identity tables.
- Repeatable synthetic seed command.
- Compose services for backend, frontend, PostgreSQL, Mailpit, and n8n.
- CI workflow for backend and frontend checks.
- School onboarding, login/logout, revocable cookie sessions, membership selection, and tenant-context checks.
- Academic years, grade levels, sections, subjects, teacher assignments, students, guardians, guardian links, enrollments, and scoped directory views.

## Requirements

- Python 3.12+ for local backend development.
- Node.js 20.9+ for Next.js. The local machine currently has Node 22, which satisfies the Next.js requirement.
- Docker Desktop for the full Compose stack.

## Local Setup

Copy the development environment file:

```powershell
Copy-Item .env.example .env
```

Start the full local stack after Docker Desktop is installed:

```powershell
docker compose up --build
```

Apply database migrations:

```powershell
docker compose exec backend alembic upgrade head
```

Seed synthetic local data:

```powershell
docker compose exec backend python -m app.seed
```

Seeded local credentials:

- Admin: `admin@schoolos.local` / `schoolos-admin-demo`
- Teacher: `teacher@schoolos.local` / `schoolos-teacher-demo`

Open the local services:

- Frontend: http://localhost:3000
- Backend health: http://localhost:8000/healthz
- API health: http://localhost:8000/api/v1/health
- Mailpit: http://localhost:8025
- n8n: http://localhost:5678

## Backend Without Docker

From `backend/`:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Use a local PostgreSQL database and set `DATABASE_URL` if you run migrations outside Compose.

## Frontend Without Docker

From `frontend/`:

```powershell
npm install
npm run dev
```

The frontend proxies `/api/backend/*` to the backend through `API_INTERNAL_URL`, defaulting to `http://localhost:8000`.

## Identity API

Current Milestone 2 endpoints:

- `POST /api/v1/auth/onboard`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/session`
- `GET /api/v1/auth/memberships`
- `POST /api/v1/auth/select-school`
- `GET /api/v1/auth/current-school`

Sessions use a random token in a secure HttpOnly cookie. Only the token hash is stored in the database. Local development uses `SameSite=Lax`, CORS credentials, and non-secure cookies; production must set `SECURE_COOKIES=true` behind HTTPS and add CSRF protection for state-changing browser requests.

## Academics And Directory API

Current Milestone 3 endpoints:

- `GET /api/v1/academics/setup`
- `POST /api/v1/academics/academic-years`
- `POST /api/v1/academics/grade-levels`
- `POST /api/v1/academics/sections`
- `POST /api/v1/academics/subjects`
- `POST /api/v1/academics/teacher-assignments`
- `GET /api/v1/students`
- `POST /api/v1/students`
- `GET /api/v1/students/{student_id}`
- `POST /api/v1/students/guardians`
- `POST /api/v1/students/{student_id}/guardians`
- `POST /api/v1/students/enrollments`
- `GET /api/v1/students/users/teachers`

Admins can create setup data and directory records. Teachers see students in assigned sections. Guardians see linked students only when portal access is enabled.

## Checks

Backend:

```powershell
cd backend
ruff check .
pytest
```

Frontend:

```powershell
cd frontend
npm run lint
npm run test
npm run typecheck
npm run build
```

## Notes

- All current data is synthetic.
- Mailpit is the only email target for local development.
- n8n is local automation only and is not treated as always-on production infrastructure.
- No paid APIs, cloud services, public deployment, or real messages are part of the MVP foundation.
