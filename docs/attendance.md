# Attendance History And Events

## User Workflow

1. Open `/dashboard/attendance`, choose the date and section, and mark the roster.
2. Save Draft. A meaningful save records an audit entry, but queues no absence event.
3. Finalize once every roster student has a mark.
4. To correct finalized attendance, change the mark or note and enter a reason.
5. Open History to see the actor, timestamp, mark transitions, and correction reasons.

History is newest-first with a Load more control. Its endpoint returns `entries` and
`has_more`; `limit` is 1-100 and `offset` must be nonnegative. It does not create a session
when one does not exist. Admins and currently assigned teachers have the same resource
scope as the register; guardians and other schools have no access.

## Transaction Boundary

Attendance mutation, audit insertion, and any outbox insertion share one SQLAlchemy
transaction and one commit. A failure storing either history or the event rolls back
the attendance change. PostgreSQL section-row locks serialize attendance writes, including
initial session creation. The database also enforces one daily session and one finalization
event idempotency key per school/session.

An unchanged draft or a correction with identical mark and note does not create history
or an event. Duplicate finalization returns the finalized register without inserting again.
This is not a general HTTP idempotency-key contract: a stale correction retried after a
different intervening correction is treated as another change.

## Audit Data

`audit_entries` records school, actor reference, operation, target, UTC instant, and changes.
Operations are `attendance.draft_saved`, `attendance.finalized`, and `attendance.corrected`.
Draft/correction changes retain before/after marks and whether the note changed, not note
contents. Correction reasons remain in staff-only audit history and should not contain
unnecessary sensitive information. History resolves the actor's current display name.

Audit entries have no update/delete API. ORM update/delete attempts are rejected. This is
application-level append-only protection, not database-level tamper resistance: direct SQL,
bulk SQLAlchemy statements, and database administration can bypass it. School deletion can
cascade history; retention and restricted production database roles remain future work.

## Outbox Contract

`outbox_events` stores `event_id`, `event_type`, `schema_version` (1), `school_id`,
`occurred_at` (UTC), `aggregate_id` (attendance session), `idempotency_key`, `payload`, and
`status` (`PENDING` until successful rule processing, then `PROCESSED`).

- `attendance.finalized`: payload has `section_id`, `school_date`, and minimal `records`
  snapshots containing record/student IDs and marks.
- `attendance.corrected`: payload also has `record_id`, `student_id`, and the corrected mark.
- Draft saves never enqueue an event.
- Payloads contain no names, addresses, free-text notes, or correction reasons.

Consumers must read the authoritative register in the event's school scope and recompute
evidence idempotently. Attendance events are now processed transactionally into follow-up
actions and student timelines. Older envelopes without snapshots remain supported; no old
mark is invented. Worker leases, retries, delivery attempts, and message approval remain
later milestones. See [action processing semantics](actions.md).

## Existing Data

Migration `0006_attendance_audit_outbox` adds tables without rewriting attendance. History
starts with changes made after this migration; it does not invent past audit entries or
retroactively enqueue already finalized registers. Historical roster queries still depend
on current student/enrollment status, rather than an immutable roster snapshot.

## Verification

- `docker compose --profile test run --build --rm backend-tests` runs the backend suite;
  attendance uses isolated PostgreSQL schemas, including concurrent session creation,
  finalization, and corrections.
- Unit/API coverage includes meaningful/no-op writes, redaction, retained corrections,
  pagination, authorization, invalid input, and event-insertion rollback for both finalize
  and correction.
- `docker compose exec backend alembic check` verifies migrated schema/model agreement.
- Frontend unit tests cover tab keyboard access, explicit reasons, history loading,
  pagination, retry, empty state, and request cancellation.
- `npm run test:e2e` in `frontend/` exercises real save/finalize/correct/history flows on
  desktop and mobile using synthetic records that are deactivated afterward.
