# SchoolOS Permissions And Page Notes

## Permission Principles

Role checks are necessary but not sufficient. Every endpoint must also enforce tenant membership and resource relationship scope.

Authorization should answer:

1. Is the actor authenticated with an active session?
2. Is the actor an active member of the selected school?
3. Does the actor's role allow this capability?
4. Does the actor have access to this specific resource?
5. Is the requested operation valid for the resource state?

## Capability Matrix

| Capability | Admin | Teacher | Guardian |
| --- | --- | --- | --- |
| Manage school settings | Yes | No | No |
| Manage members | Yes | No | No |
| Manage academic structure | Yes | No | No |
| Manage students and enrollments | Yes | No | No |
| Link guardians | Yes | No | No |
| View student profile | School scope | Assigned section scope | Linked child scope |
| Record attendance | Yes | Assigned section scope | No |
| Correct attendance | Yes | Assigned section scope | No |
| Review Action Inbox | School scope | Assigned students/actions | No |
| Resolve actions | Yes | Assigned actions | No |
| Create guardian message drafts | Yes | Assigned students/actions | No |
| Approve message drafts | Yes | Authorized assigned actions | No |
| View timeline | School scope | Assigned student scope | Guardian-visible linked child entries |
| View audit logs | Authorized admin scope | No | No |

## Resource Scope Rules

### Admin

Admins operate within the selected school. Admin rights in one school do not grant access to any other school.

### Teacher

Teachers can access students through active teacher assignments to sections and enrollments effective for the relevant date or current view. A teacher cannot access a student merely because they know the student's UUID.

### Guardian

Guardians can access only linked students where `StudentGuardian.portal_access` is true. Notification permission should be separate from portal visibility because a contact may be stored for emergencies without receiving routine messages.

## Security Notes For Later Milestones

- Use secure HttpOnly cookies for sessions.
- Avoid browser localStorage tokens.
- Document SameSite, CSRF, CORS, session expiry, logout, and rate limit behavior during identity implementation.
- Service credentials for n8n must be scoped and must not appear in exported workflow JSON.
- Logs and audit entries must redact secrets and sensitive personal data.

## Page And Wireframe Descriptions

These descriptions define expected pages without locking the UI into a final layout.

### Login

Fields for email and password. Shows validation errors and a safe generic authentication failure message. After login, users with multiple memberships choose a school context.

### School Onboarding

Admin creates the first school and first admin account. Minimal fields: school name, timezone, language, working days, admin name, admin email, and password.

### Admin Setup

Shows setup progress for academic year, grade levels, sections, teachers, students, guardians, and enrollments. Each area links to focused CRUD screens.

### School Overview

Shows real aggregates only: active students, teachers, sections, attendance completion for today, open actions, and recent audit events.

### Teacher Home

Shows today's assigned sections, draft/final attendance state, and assigned Action Inbox items. A teacher can start or resume attendance for a section.

### Attendance Roster

One row per roster student for the selected section and date. Each row supports `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, and unmarked. Draft save and finalize are distinct commands. Finalized sessions show correction controls with required reason.

### Action Inbox

Filterable list by status, assignee, reason, and student. Repeated-absence items show evidence dates and relevant attendance records. Resolution requires a reason.

### Student Profile

Shows student identity, active enrollment, guardians, attendance summary, visible timeline, and related actions based on viewer permissions.

### Message Review

Shows generated template content, recipient, delivery channel, draft revision, and approval controls. Editing content increments revision and clears approval.

### Guardian Portal

Shows linked children, guardian-visible timeline entries, notifications, and delivery-safe message content. No internal notes or audit details.

### Audit Log

Admin-only table with actor, operation, target, timestamp, and redacted change summary. It should be searchable by student or domain object later.

