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

Status: Proposed

Finalizing attendance should write attendance state, audit records, and outbox events in the same database transaction.

Consequences:

- A rollback cannot leave orphan automation work.
- Duplicate finalization must not duplicate events.
- The worker and rule processor must be idempotent.

This decision will be revisited during Milestone 4 when the exact persistence model is implemented.

## ADR-0005: Guardian Communication Requires Revision-Bound Approval

Status: Proposed

Guardian messages should start as editable drafts. Approval must reference the exact draft revision, and editing an approved draft invalidates that approval.

Consequences:

- A draft is not a sent message.
- Only approved revisions can be dispatched.
- Notification records should reference the approved revision used for delivery.

This decision will be finalized during Milestone 6.

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
