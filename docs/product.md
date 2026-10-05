# SchoolOS Product Specification

## Current Repository State

The repository is currently empty. There are no existing application files, framework choices, migrations, tests, or repository instructions to preserve. This document starts Milestone 0 and will guide the first implementation work without building a broad ERP upfront.

## Product Goal

SchoolOS is a local-first school management MVP focused on turning routine student records into follow-up work. The first useful demonstration is:

1. An admin creates a school, academic structure, teacher, students, and guardians.
2. A teacher records daily section attendance.
3. Repeated unexcused absences create one Action Inbox item.
4. A teacher reviews the student timeline.
5. A teacher reviews and approves a template-based guardian message.
6. The approved message is delivered through local automation to local email capture.
7. SchoolOS shows delivery status and audit history.

## Actors

### Admin

Owns school setup and broad operational visibility for a school. Admins manage members, academic structure, students, enrollments, guardian links, school policies, and audit review.

### Teacher

Works with assigned sections and students. Teachers record and correct attendance, review Action Inbox items for assigned students, view permitted timeline entries, and prepare guardian messages when allowed.

### Guardian

Views only explicitly linked children where portal access is granted. Guardians can see guardian-visible records and notifications, but not internal action notes, audit details, or unrelated student data.

## MVP Boundaries

The MVP includes:

- School onboarding and login.
- School memberships and roles for admin, teacher, and guardian.
- Academic years, grade levels, sections, subjects, and teacher assignments.
- Student records, guardian relationships, and enrollment history.
- Daily section attendance with draft, finalization, corrections, and summaries.
- One configurable repeated-absence rule.
- Action Inbox ownership, status, and resolution.
- Student timeline with role-dependent visibility.
- Deterministic guardian message drafts, approval, notifications, and local email delivery.
- Transactional outbox, worker delivery state, and one exported n8n workflow.
- Basic school overview, audit logs, meaningful tests, and CI.

The MVP excludes:

- Grading/report cards.
- Assignments and submissions.
- Fees and online payments.
- Admissions, transport, mobile apps, SMS, WhatsApp, and public hosting.
- Arbitrary visual rule builders.
- AI features and predictive risk scoring.
- Microservices, Kafka, Kubernetes, Redis, or a queue broker.

## Budget And Operating Assumptions

- Development must run locally with zero paid services.
- Synthetic data must be used for all demos and tests.
- Email must be captured locally through Mailpit.
- n8n is local automation only; it is not a reliable production service when the host is offline.
- No deployment, paid resource, public exposure, or real message sending happens without explicit approval.

## Business Rules

### Tenant Model

School is the tenant for v1. Every school-scoped entity carries `school_id`, and every request must verify the actor's membership and resource scope. A UUID is an identifier only, never proof of authorization.

### Attendance

Attendance is daily per section, not subject-period attendance. A session belongs to one section on one school-local date. The roster is derived from enrollments active on that date.

Valid marked states are:

- `PRESENT`
- `ABSENT`
- `LATE`
- `EXCUSED`

Unmarked is separate from `ABSENT`. Draft attendance does not trigger notifications or rules. Finalized attendance can produce domain events, audit records, and repeated-absence evaluation.

### Repeated Absence Rule

The default warning rule is two unexcused `ABSENT` records on distinct dates in the inclusive seven-calendar-day window ending on the finalized session date. The threshold and window are configurable per school.

`EXCUSED`, `LATE`, and unmarked records do not count toward this rule. The system should maintain one open repeated-absence action per student and rule, updating evidence instead of creating duplicates. A resolved action should not immediately reopen from the same evidence.

### Messaging

Guardian messages begin as editable deterministic drafts. A draft is not sent. Approval must reference the exact draft revision, authorized recipient, school, and approver. Editing an approved draft invalidates the approval. Only approved drafts may be dispatched.

Internal notes and guardian-hidden timeline entries must never appear in guardian messages.

## Primary User Experience

The first screen after login should be role-specific:

- Admins see setup progress, school overview, and high-priority open actions.
- Teachers see today's assigned sections, attendance tasks, and assigned Action Inbox items.
- Guardians see authorized children, notifications, and guardian-visible timeline entries.

The MVP should not present hardcoded placeholder data as complete functionality. If data is shown in a production-facing page, it should come from the API and persisted records.

