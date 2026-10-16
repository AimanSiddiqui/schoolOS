# SchoolOS

SchoolOS is a local-first school-management MVP focused on attendance, follow-up actions, student timelines, and approved guardian communication.

## Current Status

Milestones 0 through 5 and the draft/approval portion of Milestone 6 have working local slices:

- FastAPI backend with health endpoints.
- Next.js frontend shell with a live backend health check.
- PostgreSQL schema migration for the first tenant/identity tables.
- Repeatable synthetic seed command.
- Compose services for backend, frontend, PostgreSQL, Mailpit, and n8n.
- CI workflow for backend and frontend checks.
- School onboarding, login/logout, revocable cookie sessions, membership selection, and tenant-context checks.
- Academic years, grade levels, sections, subjects, teacher assignments, students, guardians, guardian links, enrollments, scoped directory views, student search/filtering, profile details, edit, and deactivate.
- Academic setup maintenance, including edit/deactivate flows for years, grade levels, sections, subjects, and teacher assignments.
- Enrollment end-date/status edits and guardian-link relationship/portal edits.
- Tabbed admin workspace views for overview, academic setup, directory, student profile, and maintenance.
- Attendance sessions, roster loading, draft save, finalization, corrections, section summaries, and admin/teacher-scoped attendance UI.
- Attendance History tab with actor, timestamp, mark transitions, and correction reasons.
- Transactional audit/outbox writes, repeated-absence evaluation, and duplicate-finalization protection.
- Configurable repeated-absence rule, scoped Action Inbox, ownership, status changes, required
  closing reasons, and correction-aware evidence history.
- Student timelines in action review and student profiles, with server-enforced guardian visibility.
- Guardian-message templates, editable drafts, exact-revision approval, and staff-only revision
  history inside the Action Inbox. Approval does not send a message.
- Notification records, delivery status, and the background delivery worker are not implemented yet.
- Consistent public/auth design and a responsive dashboard with one sidebar, role-specific navigation, real overview metrics, and separate student, academic, attendance, and account routes.
- Student directory with searchable records, individual profiles, and focused creation dialogs.

## Message Review

To review a guardian message, open **Action Inbox**, select an active follow-up, and choose
**Messages**. The student needs a guardian contact with notification permission and a valid
email address. Teachers must own the follow-up. Save edits before approving the displayed
revision. See [message review](docs/communication.md) for permissions and limitations.

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
docker compose up -d --build
```

Seed synthetic local data:

```powershell
docker compose exec backend python -m app.seed
```

Seeded local credentials:

- Admin: `admin@schoolos.local` / `schoolos-admin-demo`
- Teacher: `teacher@schoolos.local` / `schoolos-teacher-demo`

For an already-onboarded local demo school with no synthetic teacher, add only that account:

```powershell
docker compose exec backend python -m app.seed --teacher-school YOUR_EXISTING_SCHOOL_UUID
```

The school UUID is available from `GET /api/v1/auth/session`. This opt-in command does not
reset existing passwords or change existing memberships. Assign the teacher to a section in
Academics before using their attendance workspace.

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

## Docker Notes

The backend container runs `alembic upgrade head` before starting Uvicorn, so the local PostgreSQL schema is upgraded automatically during `docker compose up`.

If the current terminal does not see `docker` immediately after installing Docker Desktop, refresh the terminal or prepend Docker's bin folder for the session:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
```

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
- `PATCH /api/v1/academics/academic-years/{academic_year_id}`
- `POST /api/v1/academics/academic-years/{academic_year_id}/deactivate`
- `POST /api/v1/academics/grade-levels`
- `PATCH /api/v1/academics/grade-levels/{grade_level_id}`
- `POST /api/v1/academics/grade-levels/{grade_level_id}/deactivate`
- `POST /api/v1/academics/sections`
- `PATCH /api/v1/academics/sections/{section_id}`
- `POST /api/v1/academics/sections/{section_id}/deactivate`
- `POST /api/v1/academics/subjects`
- `PATCH /api/v1/academics/subjects/{subject_id}`
- `POST /api/v1/academics/subjects/{subject_id}/deactivate`
- `POST /api/v1/academics/teacher-assignments`
- `PATCH /api/v1/academics/teacher-assignments/{assignment_id}`
- `POST /api/v1/academics/teacher-assignments/{assignment_id}/deactivate`
- `GET /api/v1/students`
- `POST /api/v1/students`
- `GET /api/v1/students/{student_id}`
- `PATCH /api/v1/students/{student_id}`
- `POST /api/v1/students/{student_id}/deactivate`
- `GET /api/v1/students/guardians`
- `POST /api/v1/students/guardians`
- `POST /api/v1/students/{student_id}/guardians`
- `POST /api/v1/students/enrollments`
- `PATCH /api/v1/students/enrollments/{enrollment_id}`
- `PATCH /api/v1/students/guardian-links/{guardian_link_id}`
- `GET /api/v1/students/users/teachers`

Admins can create setup data and directory records. Teachers see students in assigned sections. Guardians see linked students only when portal access is enabled.

## Attendance API

- `GET /api/v1/attendance/sections?school_date=YYYY-MM-DD`
- `GET /api/v1/attendance/sections/{section_id}?school_date=YYYY-MM-DD`
- `POST /api/v1/attendance/sections/{section_id}/draft?school_date=YYYY-MM-DD`
- `POST /api/v1/attendance/sections/{section_id}/finalize?school_date=YYYY-MM-DD`
- `PATCH /api/v1/attendance/records/{record_id}`
- `GET /api/v1/attendance/sections/{section_id}/history?school_date=YYYY-MM-DD&limit=25&offset=0`

Admins and currently assigned teachers can access a register's history. Guardians cannot.
See [attendance semantics and event contracts](docs/attendance.md) for details and limitations.

## Action Inbox And Timeline

Open `/dashboard/actions`. The default rule is two unexcused absence dates within an
inclusive seven-calendar-day window. Finalized attendance updates follow-up work immediately;
drafts do not. Admins can change the rule and assign eligible teachers. Teachers can claim
unassigned actions for their currently assigned students and update their own actions.
Closing an action requires a reason. Corrections update evidence without deleting history.

- `GET /api/v1/actions` supports `status_filter`, `owner`, `q`, `limit`, and `offset`.
- `GET /api/v1/actions/{action_id}`
- `PATCH /api/v1/actions/{action_id}` requires `expected_revision`.
- `GET /api/v1/actions/assignees?student_id={student_id}`
- `GET /api/v1/actions/policy` and admin-only `PUT /api/v1/actions/policy`
- `GET /api/v1/timeline/students/{student_id}?limit=25&offset=0`

Catch up previously queued attendance events without sending messages:

```powershell
docker compose exec backend python -m app.actions.process_events
```

See [rule and lifecycle semantics](docs/actions.md) for suppression after closure, policy
changes, privacy, and local-MVP processing limits.

## Checks

Backend:

```powershell
cd backend
ruff check .
pytest
```

Run the backend suite with real PostgreSQL attendance transactions and concurrency checks
from the repository root:

```powershell
docker compose --profile test run --build --rm backend-tests
```

Attendance/action tests use disposable, randomly named schemas and remove them afterward;
identity and directory tests still use SQLite fixtures. This command runs inside Docker's network, so it
also works when another PostgreSQL installation occupies the host's port 5432. CI runs both
the default suite and PostgreSQL attendance/action tests, plus migration/schema checks.

Frontend:

```powershell
cd frontend
npm run lint
npm run test
npm run typecheck
npm run build
```

Browser checks run against an already running, seeded local stack:

```powershell
cd frontend
npm run test:e2e
```

The browser suite uses installed Google Chrome by default and checks desktop and mobile login,
signup, navigation, directory dialogs, attendance, history, logout, asset loading, and page overflow.
The teacher scenario also verifies attendance-to-action creation, ownership, timeline review,
and resolution. It requires an enabled rule and a synthetic teacher in the selected school.
It uses the synthetic admin credentials above; `SCHOOLOS_TEST_EMAIL`, `SCHOOLOS_TEST_PASSWORD`,
and `SCHOOLOS_TEST_URL` can override them. For a bundled Chromium installation, run
`npx playwright install chromium` and set `SCHOOLOS_BROWSER_CHANNEL=chromium`.
Screenshots are saved under `frontend/test-results/`.
The attendance scenario creates dedicated synthetic students and sections, then deactivates
them afterward. Their attendance and audit records remain as history; it does not overwrite
existing registers.
Teacher overrides are `SCHOOLOS_TEST_TEACHER_EMAIL` and `SCHOOLOS_TEST_TEACHER_PASSWORD`.
The action scenario deactivates its synthetic teacher assignment too and closes any unfinished
test action during cleanup. Rule settings are never changed by the browser scenario.

## Notes

- All current data is synthetic.
- Mailpit is the only email target for local development.
- n8n is local automation only and is not treated as always-on production infrastructure.
- No paid APIs, cloud services, public deployment, or real messages are part of the MVP foundation.
