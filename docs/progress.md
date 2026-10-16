# SchoolOS Progress

## Current State

Milestones 0 through 5 have working local slices, including attendance audit history,
transactional rule processing, an Action Inbox, and scoped student timelines. Milestone 6
now includes guardian-message drafts, revision history, and exact-revision approval.
Notification records, the delivery worker, and n8n/Mailpit delivery remain upcoming work.
The public pages and dashboard now share a consistent visual system with separate student and academic workflows.
The repository was empty when inspected:

- No existing application source files.
- No initial `AGENTS.md` or repository-specific instructions were found. Next.js later generated
  `frontend/AGENTS.md` and `frontend/CLAUDE.md` for this Next version.
- Git repository initialized in this workspace.
- No existing tests, migrations, CI, or setup documentation.

Current local tool check:

- Python 3.12.7 is available.
- Node.js 22.14.0 is available.
- Docker Desktop is installed and the full Compose stack has been runtime-verified locally.

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

Acceptance status: Complete for the reproducible foundation. Docker Desktop is installed and the full runtime path has been verified locally:

- `docker compose up -d --build`
- backend startup runs `alembic upgrade head`
- frontend responds on `http://localhost:3000`
- backend responds on `http://localhost:8000/healthz`
- Mailpit responds on `http://localhost:8025`
- n8n responds on `http://localhost:5678`

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

Runtime verification:

- Docker Compose stack verified with PostgreSQL, backend, frontend, Mailpit, and n8n running locally.
- Real onboarding request succeeded against Dockerized PostgreSQL after migrations.

### Milestone 3: Academics And Student Directory

- [x] Create academic year, configurable levels, sections, subjects, and teacher assignments.
- [x] Implement student search/create/edit/deactivate and guardian links.
- [x] Implement enrollment dates/history and teacher/guardian-scoped views.
- [x] Build real API-backed directory/profile and admin setup pages.

Completed slice:

- Added `academic_years`, `grade_levels`, `sections`, `subjects`, `teacher_assignments`, `students`,
  `guardians`, `student_guardians`, and `enrollments` models and migration.
- Added admin APIs for academic setup, students, guardians, guardian links, and enrollments.
- Added role-scoped student listing/detail access for admin, assigned teacher, and linked guardian.
- Added frontend admin setup workspace backed by the real APIs.
- Added student directory search and filters for text, status, section, and grade level.
- Added student profile panel with enrollment and guardian details.
- Added student update and deactivate flows.
- Added selectable guardian linking from API-loaded guardians.
- Added academic setup edit/deactivate flows for academic years, grade levels, sections, subjects,
  and teacher assignments.
- Added enrollment end-date/status editing and guardian-link relationship/portal editing.
- Split the admin workspace into overview, academic setup, directory, student profile, and maintenance views.
- Added `0004_academic_statuses` migration so academic setup records can be deactivated without
  hard deletion.
- Added backend tests for full admin setup flow, cross-school rejection, teacher scoping, guardian scoping, search/filter/profile/update/deactivate, academic maintenance, enrollment editing, and guardian-link editing.
- Added frontend tests for setup loading, academic year submit, non-admin blocking, directory filtering, student update, academic maintenance, enrollment update, and guardian-link update.

Remaining Milestone 3 work:

- Optional browser E2E coverage for the admin setup journey.
- More ergonomic multi-record editing for schools with many years, sections, assignments, guardians,
  and enrollments.

Local checks completed:

- `backend/.venv/Scripts/python.exe -m ruff check .`: passed.
- `backend/.venv/Scripts/python.exe -m pytest`: passed, 14 tests, 1 upstream deprecation warning from FastAPI/Starlette TestClient.
- `frontend npm run lint`: passed.
- `frontend npm run test`: passed, 9 tests.
- `frontend npm run typecheck`: passed.
- `frontend npm run build`: passed.

### Milestone 4: Attendance Vertical Slice

- [x] Build today's sections and attendance roster UI.
- [x] Implement draft save, finalize, correction, and summaries.
- [x] Handle missing marks, duplicate finalize requests, and backend school-local date defaults.
- [x] Derive rosters from enrollment dates (current status still applies; no immutable snapshot).
- [x] Create audit entries and transactional outbox events on meaningful transitions.

Completed slice:

- Added `attendance_sessions` and `attendance_records` models and migration.
- Added admin/assigned-teacher attendance APIs for section summaries, roster loading, draft save,
  finalization, and finalized-record correction.
- Added attendance workspace UI with date/section selection, roster marks, draft save, finalization,
  and correction controls.
- Added backend tests for attendance save/finalize/correction and assigned-section teacher scoping.
- Added frontend tests for attendance loading, draft save, finalization, and role-context blocking.

Local checks completed:

- `backend/.venv/Scripts/python.exe -m ruff check backend`: passed.
- `backend/.venv/Scripts/python.exe -m pytest backend/tests`: passed, 16 tests, upstream TestClient warnings.
- `frontend npm run lint`: passed.
- `frontend npm run test`: passed, 11 tests.
- `frontend npm run typecheck`: passed.
- `frontend npm run build`: passed.

### Milestone 5: Rule, Action Inbox, And Timeline

- [x] Implement the supported repeated-absence rule and settings.
- [x] Create/update Action Items with evidence and ownership.
- [x] Add open/in-progress/resolved/dismissed lifecycle and resolution reasons.
- [x] Add student timeline and role-dependent visibility.
- [x] Recompute evidence after corrections without erasing history.

### Milestone 6: Messages, Worker, And n8n

- [x] Build editable template drafts, staff-only revision history, and revision-bound approval.
- [ ] Add notification records tied to the approved revision.
- [ ] Implement outbox worker with leases/retries and observable failures.
- [ ] Export credential-free n8n workflow JSON plus import/configuration instructions.
- [ ] Add in-app notifications and delivery status UI.

### Milestone 7: MVP Polish And Verification

- [x] Add landing, login, and dashboard shell structure with side navigation and tabs.
- [x] Build role-specific navigation and school overview with real aggregates.
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

Continue Milestone 6 with notification records, a leased/retrying delivery worker, local
n8n/Mailpit delivery, and delivery status. Dispatch must revalidate the exact approved
revision, current recipient permission, evidence, and staff authorization.

### Guardian Message Review: 2026-10-16

- Added migration `0008_message_review` with tenant-linked drafts, revision snapshots,
  and unique exact-revision approval records.
- Added deterministic templates using only student, guardian, school, and absence-date
  fields. Internal notes and closing reasons are never copied into templates.
- Added a Messages tab inside follow-up review with eligible contacts, editable content,
  explicit save/approve controls, history pagination, and unsaved-change close protection.
- Current ownership, active assignments, recipient permission/contact, action revision,
  and persisted text are checked on approval. Meaningful edits invalidate approval.
- Drafts and approvals write redacted audit and staff-only timeline entries transactionally.
- No notifications, delivery jobs, external automation calls, or emails are created.
- Local verification: 63 backend tests passed against PostgreSQL, including concurrent
  approval/edit and unsafe-recipient regression cases. All 62 frontend unit tests and
  all 8 desktop/mobile Playwright scenarios
  passed. Browser coverage includes draft creation, edits, exact-revision approval, history,
  reopen/persistence, unsaved-change protection, and invalidation after action closure.
  Screenshots were inspected for desktop/mobile layout. Backend/frontend lint, production
  Docker builds, and TypeScript passed. PostgreSQL is at `0008_message_review` and
  `alembic check` found no schema drift. CI includes PostgreSQL communication tests;
  remote CI has not been run.

See [message review](communication.md) for the API contract and remaining limits.

### Action Inbox And Student Timeline: 2026-10-16

- Added migration `0007_actions_timeline` with attendance policies, action items, and scoped
  timeline entries. One active action per student/rule is enforced by a partial unique index.
- Implemented distinct-date, inclusive-window rules; correction-aware evidence; closed-date
  suppression; eligible teacher ownership; revision-checked edits; and closing reasons.
- Added `/dashboard/actions` with server-side filters/search, paginated records, action review,
  keyboard tabs, teacher claiming, admin policy settings, and a scoped student timeline.
- Added timelines to student profiles. Guardians receive only guardian-visible attendance
  entries through the API, never internal action/evidence/reason data.
- Rule processing runs transactionally for new finalized/corrected attendance. A catch-up
  command handles older queued events and returned zero on a second run after processing nine.
- Added an opt-in local teacher seed for already-onboarded demo schools without resetting
  passwords or existing memberships. Verified the documented teacher credentials locally.
- At completion of this slice, message review and delivery were not implemented. Draft
  review is now covered by the Milestone 6 slice above. Notification delivery, a background
  delivery worker, and a dedicated guardian timeline screen remain pending.

Verification completed locally:

- All 43 backend tests passed in the Compose test profile; attendance, action, and demo-seed
  fixtures used isolated PostgreSQL schemas. Rule boundary, correction, privacy, rollback,
  duplicate-event, and concurrent-finalization cases passed.
- All 51 frontend unit tests passed. Frontend/backend lint, production Docker build, and
  TypeScript checks passed.
- All 8 desktop/mobile Playwright scenarios passed with no skips. The teacher journey
  covers finalized attendance, owned action creation, timeline, progress, and resolution.
- Fixed mobile table-heading overflow found during browser testing and strengthened viewport
  assertions. Inspected populated inbox, review, and timeline screenshots after the fix.
- PostgreSQL is at `0007_actions_timeline`; `alembic check` reports no schema drift.
- Existing app services remain running. Synthetic browser fixtures, including the timed-out
  test fixture, were closed/deactivated without deleting history or changing other registers.
- CI PostgreSQL selection includes attendance and action tests; remote CI has not been run.

### Attendance History And Outbox: 2026-10-16

- Added migration `0006_attendance_audit_outbox`, staff-scoped paginated history, and a
  keyboard-accessible History tab with loading, empty, retry, and pagination states.
- Meaningful drafts record redacted audit changes; finalize/correct also enqueue versioned,
  minimal-payload events in the same transaction. Unchanged requests do not duplicate work.
- Section-row locks serialize PostgreSQL attendance mutations; unique event keys protect
  duplicate finalization. Audit ORM updates/deletes are rejected at application level.
- Correction reasons are explicit and retained in history; free-text note contents are not.
- Section summaries update immediately after writes, and the date picker defaults to the
  school's timezone instead of UTC, including midnight-boundary regression coverage.
- Added isolated PostgreSQL test schemas, a Compose test profile, and CI PostgreSQL/migration
  checks. Full cross-module PostgreSQL fixtures remain future work.
- At completion of this slice, historical entries were not backfilled and events stayed
  pending. The Milestone 5 slice above now processes attendance events; message delivery
  remains pending. See `docs/attendance.md` for the current contract and limitations.

Verification completed locally:

- Backend lint passed; Compose test profile passed all 26 backend tests, with attendance
  running on PostgreSQL and concurrent creation/finalization/correction coverage.
- Frontend lint passed; all 39 unit tests passed; production Docker build and TypeScript
  checks passed.
- All 6 desktop/mobile Playwright scenarios passed against the rebuilt stack. Inspected
  populated correction-history screenshots and checked horizontal overflow.
- PostgreSQL is at `0006_attendance_audit_outbox`; `alembic check` reports no schema drift.
- Existing local app services remain running. Only dedicated browser-test fixtures were
  deactivated; existing registers were not overwritten. CI checks are configured, not yet
  verified on a remote runner.

### Interface Organization: 2026-10-15

- Replaced the active layered styles with shared base, workspace, and public style sheets.
- Added a light sidebar, compact header, Lucide icons, responsive mobile navigation, and keyboard handling.
- Separated Students from Academics; creation dialogs keep routine directory browsing focused on records.
- Added API-backed student counts, roster completion, section progress, and a scoped overview for guardians.
- Reworked landing/login/signup pages and removed invented attendance/student/follow-up totals.
- Added Playwright checks using the running local API and installed Chrome for desktop and mobile.
- Added regression coverage for overview aggregates, empty rosters, guardian scope, and teacher navigation.
- The full setup-to-approved-message E2E journey remains pending Milestone 6.
- Replaced the form-first academic screen with searchable, paginated lists for sections,
  academic years, grade levels, subjects, and teaching assignments. Row editors load the
  selected record and retain entered values after save failures.
