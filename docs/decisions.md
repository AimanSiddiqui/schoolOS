# Architecture Decisions

## ADR-0001: Start With A Modular Monolith

Status: Accepted

SchoolOS will start as a modular monolith with a Next.js frontend, FastAPI backend, PostgreSQL persistence, and a Python worker. This keeps the system understandable and locally runnable while still allowing clear domain boundaries.

Consequences:

- No microservices for the MVP.
- No Redis or queue broker until a concrete requirement appears.
- Domain modules should own their routes, schemas, services, and persistence logic where useful.

## ADR-0002: School Is The Tenant Boundary For V1

Status: Accepted

`School` is the tenant for v1. Users can have memberships in multiple schools, and authorization must always verify the selected school membership plus resource scope.

Consequences:

- Most persisted business entities include `school_id`.
- UUID knowledge does not grant access.
- Background jobs and n8n integration endpoints must carry explicit tenant context.

## ADR-0003: Keep Development Local And Free

Status: Accepted

The MVP must run locally without paid APIs, cloud accounts, production student data, public exposure, or external LLM calls.

Consequences:

- Use Mailpit for local email capture.
- Use local n8n only for demonstration automation.
- Do not recommend hosting or paid services without checking current terms and getting approval.

## ADR-0004: Attendance Finalization Emits Transactional Events

Status: Accepted

Finalization and corrections write attendance state, audit records, and outbox events in
the same database transaction. Meaningful draft saves write only audit history.

Consequences:

- A rollback cannot leave orphan automation work.
- Duplicate finalization must not duplicate events.
- The worker and rule processor must be idempotent.

PostgreSQL section-row locks serialize all register mutations, including creation; a unique
school/idempotency key protects the finalization event. Notes and correction reasons are
excluded from event payloads. Audit changes omit note contents, retain correction reasons
for authorized staff, and have application-level append-only guards. Details and limitations
are recorded in [attendance history and events](attendance.md). Delivery-worker retry/lease
state remains Milestone 6. Attendance rule consumption is now implemented
as described in ADR-0008.

## ADR-0005: Guardian Communication Requires Revision-Bound Approval

Status: Accepted

Guardian messages should start as editable drafts. Approval must reference the exact draft revision, and editing an approved draft invalidates that approval.

Consequences:

- A draft is not a sent message.
- Only approved revisions can be dispatched.
- Notification records should reference the approved revision used for delivery.

Drafts, immutable revision snapshots, and approval records are implemented in migration
`0008_message_review`. Meaningful edits increment the revision and clear its current approval.
Approval rechecks the active follow-up, current attendance evidence revision, recipient
permission/contact, and staff authorization. History and approval writes are transactional.
Audit/timeline records omit message content and contact addresses. Full message snapshots
are staff-only. ORM append-only guards are application-level, not SQL tamper resistance.

Notification records and dispatch remain future work. Approval creates no delivery work.
The eventual worker must revalidate approval before dispatch, not trust a historical stamp.
See [message review](communication.md).

## ADR-0006: Use Biome For Frontend Linting And Formatting

Status: Accepted

The frontend uses Biome for linting and formatting, plus TypeScript for type checks. Next.js remains the application framework.

Context:

- Next.js 16.3.8 was selected after checking current Next.js package metadata.
- The current `eslint-config-next` package still pulls ESLint peer dependencies that do not cleanly support the newest ESLint major.
- Biome 2.5.15 provides current linting and formatting with a much smaller dependency tree for this new project.

Consequences:

- `npm run lint` runs `biome check .`.
- `npm run format` runs `biome format --write .`.
- Next-specific ESLint rules are not part of the initial foundation.
- TypeScript remains responsible for type safety through `npm run typecheck`.

## ADR-0007: Use Revocable Server-Side Sessions

Status: Accepted

SchoolOS uses server-side sessions for browser authentication. The browser stores a random session token in an HttpOnly cookie, and the database stores only the SHA-256 hash of that token.

Context:

- The product needs logout, revocation, membership selection, and explicit tenant context.
- Cookies avoid storing bearer tokens in browser localStorage.
- Server-side sessions make tenant context visible and auditable in the database.

Consequences:

- Session cookies use `SameSite=Lax`, `HttpOnly`, path `/`, and configurable `Secure`.
- Local development sets `SECURE_COOKIES=false`; production must set it to true behind HTTPS.
- Passwords are hashed with `pwdlib[argon2]`.
- Current CSRF stance is documented but not complete for production; Milestone 2 is local-only.
- Every protected endpoint must derive the user and selected school from the session, not from client trust.

## ADR-0008: Transactional Local Rule Processing

Status: Accepted For Local MVP

Repeated-absence evaluation and student timeline generation run inside the attendance
transaction for new events. A school-row lock serializes rules, policy changes, and action
updates; a partial unique index ensures one active student/rule action. A tenant-scoped
catch-up command handles older pending attendance events, while refreshed event status and
timeline source keys prevent duplicate processing.

Corrections change active evidence without erasing history or silently closing work.
Closed evidence end dates suppress immediate recreation, and newer qualifying evidence can
open a new action. Manual edits use optimistic revisions. Staff action history is never
guardian-visible; guardian attendance entries exclude free-text notes and correction reasons.

This favors a working, atomic local flow. It is not a substitute for Milestone 6 delivery
leases, retries, and observable external failures. Scaling history scans and moving rule
execution off the request path can follow once there is a concrete throughput need.
Detailed semantics are in [actions and timeline](actions.md).
