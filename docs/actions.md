# Repeated Absence, Action Inbox, And Timeline

## Rule

The default school policy is enabled, with a threshold of two distinct unexcused `ABSENT`
dates in an inclusive seven-calendar-day window. `LATE`, `EXCUSED`, `PRESENT`, unmarked
records, and draft registers do not qualify. Multiple section records on one date count
only once. Admins may configure a threshold of 1-30 and a window of 1-90 days; the
threshold cannot exceed the window.

On a finalized or corrected attendance event, the processor reads authoritative finalized
records for each affected student in the event's school. It finds the latest qualifying
historical window and creates or updates one active `repeated_absence` action. A partial
unique index prevents two `OPEN`/`IN_PROGRESS` actions for the same school/student/rule.

An open action represents work to review, not a continuously expiring alert. Its evidence
window is retained when time passes or a correction removes qualification. Corrections
recompute evidence, increment the action revision when meaningful, and append before/after
evidence to the staff timeline and audit history. Actions that no longer meet the rule
remain open with a warning until a person closes them.

## Ownership And Closure

- Admins see school-scoped actions and may assign eligible teachers or leave work unassigned.
- Teachers see actions for students in their currently active sections/enrollments, using
  the school's current date. Knowing an action UUID does not grant access.
- The finalizing teacher is the preferred initial owner only when currently eligible.
- Teachers may claim unassigned actions or update their own. They cannot reassign work
  to someone else or change another teacher's action.
- Active statuses are `OPEN` and `IN_PROGRESS`; closing statuses are `RESOLVED` and
  `DISMISSED`. Closing requires a nonblank reason of at least three characters.
- Closed actions are immutable through the API. The latest closed action's evidence end
  date suppresses recreation from those same dates. A qualifying window with a newer
  absence date can create a new action. Old closed history remains available.
- Updates require the current `expected_revision`. A stale editor receives HTTP 409
  instead of overwriting evidence or another person's changes.

## Policy Changes

Policy updates are admin-only and audited. Changing enabled state, threshold, or window
recomputes school students' existing finalized evidence. This can create new actions from
historical evidence or change active evidence. Disabling the rule prevents creation and
marks open work as not currently qualifying; it does not silently resolve work. Closed
actions and their suppression dates are retained.

## Transaction And Catch-Up

For this local MVP, attendance state, audit, outbox insertion, rule evaluation, timeline,
action changes, and the outbox `PROCESSED` status commit together. A processing failure
rolls back the attendance transition so it can be retried. School-row locks serialize
rule processing and action/policy writes; section-row locks still protect register writes.
The API does not call external automation or send messages.

Previously queued events can be processed with:

```powershell
docker compose exec backend python -m app.actions.process_events
```

The command handles only attendance event types, in tenant-scoped batches of 100. It
refreshes event state under the same school lock and ignores already processed events.
Unknown event types remain pending. Unsupported attendance schemas or invalid references
fail the current batch without committing partial work. Running the command again is safe.
This is not the leased/retrying background delivery worker planned for Milestone 6.

## Timeline Privacy

Student timelines are paginated and scoped independently of the inbox:

- Admins may see `INTERNAL`, `STAFF`, and `GUARDIAN` entries in their school.
- Currently assigned teachers may see `STAFF` and `GUARDIAN` entries for their students.
- Linked guardians with portal access may see only `GUARDIAN` entries for that child.
- Attendance entries contain only the date and mark, not staff notes or correction reasons.
- Action entries, evidence changes, ownership, and closing reasons stay staff-only.

New attendance events include minimal mark snapshots so a later correction cannot rewrite
what an earlier timeline entry says. Old queued events without a snapshot receive a generic
attendance entry rather than an invented historical mark. Rule evaluation always uses
current authoritative records, even when processing older events.

## Limits

Processing is synchronous, serialized per school, and may scan a student's attendance
history. Policy updates recompute the school in one transaction. This is suitable for the
local MVP, not a high-volume production worker. There are no delivery leases, automatic
retry scheduler or guardian-message sends yet. Draft review and revision-bound approvals
are implemented separately; see [message review](communication.md). General membership
management is also pending; the local synthetic teacher seed is opt-in only.

Historical rosters still depend on current student/enrollment status. Actions are retained
for inactive students for admin historical review. Timeline entries are generated from
events processed after these tables exist; registers with no outbox event are not backfilled.
