# SchoolOS Progress

## Current State

Milestones 0 through 2 are complete. Milestone 3 has a tested academics and directory setup slice.
The repository was empty when inspected:

- No existing application source files.
- No initial `AGENTS.md` or repository-specific instructions were found. Next.js later generated
  `frontend/AGENTS.md` and `frontend/CLAUDE.md` for this Next version.
- No Git metadata found from this workspace path.
- No existing tests, migrations, CI, or setup documentation.

Current local tool check:

- Python 3.12.7 is available.
- Node.js 22.14.0 is available.
- Docker is not installed, so the full Compose stack has not been run on this machine yet.

## Milestone Checklist

### Milestone 0: Product Specification

- [x] Inspect repository and summarize current state.
- [x] Write `docs/product.md` with actors, MVP boundaries, and the primary demo.
- [x] Write `docs/domain.md` with ER diagram, ownership, constraints, and attendance semantics.
- [x] Write `docs/permissions.md` with permissions and basic page descriptions.
- [x] Record assumptions and milestone checklist.

Acceptance status: Complete for initial planning. The requirements define daily attendance, guardian visibility, action lifecycle, and message approval without contradictory definitions.

### Milestone 1: Reproducible Foundation

- [x] Set up frontend, API, PostgreSQL, migrations, Mailpit, and n8n in Compose.
- [x] Provide health checks, `.env.example`, safe defaults, formatting/linting, and typed API contracts.
- [x] Add synthetic seed data and documented migration/seed commands.
- [x] Add CI for checks that exist at this stage.

Acceptance status: Source implementation is complete. Full runtime acceptance still needs verification on a machine with Docker Desktop installed:

- `docker compose up --build`
- `docker compose exec backend alembic upgrade head`
- `docker compose exec backend python -m app.seed`
- frontend health check reaching the backend through `/api/backend/health`

Local checks completed:

- `python -m py_compile` for backend Python files: passed.
- `backend/.venv/Scripts/python.exe -m ruff check .`: passed.
- `backend/.venv/Scripts/python.exe -m pytest`: passed, 2 tests, 1 upstream deprecation warning from FastAPI/Starlette TestClient.
- `frontend npm run lint`: passed.
- `frontend npm run test`: passed, 4 tests.
- `frontend npm run typecheck`: passed.
- `frontend npm run build`: passed.
- `frontend npm audit --omit=dev`: passed with 0 production vulnerabilities.

### Milestone 2: Identity And Tenant Isolation

- [x] Implement school onboarding, admin creation, login/logout, and sessions.
- [x] Implement membership selection and roles.
- [x] Add tenant-scoped dependencies and resource authorization.
- [x] Test two schools, multiple memberships, missing membership, tampered identifiers, and revoked sessions.

Acceptance status: Complete for the identity and tenant-context slice. The backend enforces active sessions, active memberships, school selection, and rejection of unauthorized or random school identifiers. The frontend includes onboarding, login, session refresh, membership selection, and logout.

Local checks completed:

- `backend/.venv/Scripts/python.exe -m ruff check .`: passed.
- `backend/.venv/Scripts/python.exe -m pytest`: passed, 8 tests, 1 upstream deprecation warning from FastAPI/Starlette TestClient.
- `frontend npm run lint`: passed.
- `frontend npm run typecheck`: passed.
- `frontend npm run build`: passed.

Remaining environment gap:

- Docker is still not installed on this machine, so Compose, PostgreSQL migrations, Mailpit, and n8n have not been runtime-verified locally.

### Milestone 3: Academics And Student Directory

- [x] Create academic year, configurable levels, sections, subjects, and teacher assignments.
- [ ] Implement student search/create/edit/deactivate and guardian links.
- [x] Implement enrollment dates/history and teacher/guardian-scoped views.
- [ ] Build real API-backed directory/profile and admin setup pages.

Completed slice:

- Added `academic_years`, `grade_levels`, `sections`, `subjects`, `teacher_assignments`, `students`,
  `guardians`, `student_guardians`, and `enrollments` models and migration.
- Added admin APIs for academic setup, students, guardians, guardian links, and enrollments.
- Added role-scoped student listing/detail access for admin, assigned teacher, and linked guardian.
- Added frontend admin setup workspace backed by the real APIs.
- Added backend tests for full admin setup flow, cross-school rejection, teacher scoping, and guardian scoping.
- Added frontend tests for setup loading, academic year submit, and non-admin blocking.

Remaining Milestone 3 work:

- Student search, edit, and deactivate.
- Fuller student profile view.
- Better guardian selection after creation instead of manually showing the latest guardian id.
- Runtime verification against PostgreSQL once Docker is available.

Local checks completed:

- `backend/.venv/Scripts/python.exe -m ruff check .`: passed.
- `backend/.venv/Scripts/python.exe -m pytest`: passed, 12 tests, 1 upstream deprecation warning from FastAPI/Starlette TestClient.
- `frontend npm run lint`: passed.
- `frontend npm run test`: passed, 7 tests.
- `frontend npm run typecheck`: passed.
- `frontend npm run build`: passed.

### Milestone 4: Attendance Vertical Slice

- [ ] Build today's sections and attendance roster UI.
- [ ] Implement draft save, finalize, correction, and summaries.
- [ ] Handle missing marks, duplicate requests, date/timezone rules, and historical rosters.
- [ ] Create audit entries and transactional outbox events on meaningful transitions.

### Milestone 5: Rule, Action Inbox, And Timeline

- [ ] Implement the supported repeated-absence rule and settings.
- [ ] Create/update Action Items with evidence and ownership.
- [ ] Add open/in-progress/resolved/dismissed lifecycle and resolution reasons.
- [ ] Add student timeline and role-dependent visibility.
- [ ] Recompute evidence after corrections without erasing history.

### Milestone 6: Messages, Worker, And n8n

- [ ] Build editable template drafts, revision-bound approval, and notification records.
- [ ] Implement outbox worker with leases/retries and observable failures.
- [ ] Export credential-free n8n workflow JSON plus import/configuration instructions.
- [ ] Add in-app notifications and delivery status UI.

### Milestone 7: MVP Polish And Verification

- [ ] Build role-specific navigation and school overview with real aggregates.
- [ ] Add loading, empty, validation, forbidden, and error states.
- [ ] Check keyboard access, labels, responsive layout, and accessible status colors.
- [ ] Add one browser E2E demo covering the primary journey.
- [ ] Finish API/integration tests for isolation, corrections, duplicate processing, and failure recovery.
- [ ] Write README demo instructions, architecture explanation, and known limitations.

## Assumptions

- `School` is the v1 tenant boundary.
- The first implementation milestone after this specification should be Milestone 1.
- The MVP should use Next.js, FastAPI, PostgreSQL, Alembic, Mailpit, n8n, pytest, and browser E2E tooling unless implementation research finds a compatibility issue.
- Development and demos use synthetic data only.
- Public hosting, real email delivery, paid APIs, and AI features are out of scope until explicitly requested.

## Next Implementation Step

Finish the remaining Milestone 3 directory work:

- Add student search, edit, and deactivate endpoints and UI.
- Add a focused student profile surface with enrollment and guardian details.
- Improve guardian linking to use selectable guardians from API data.
- Keep tenant-scope tests for each new read/write path.
