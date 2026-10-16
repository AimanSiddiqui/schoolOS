# Guardian Message Review

Milestone 6 currently implements drafting and approval only. Neither action sends an email,
creates a notification/outbox delivery event, nor calls n8n. The UI shows **Not sent** even
after approval. Local delivery through Mailpit is a separate implementation step.

## Workflow

Open **Action Inbox**, select an active follow-up, and open **Messages**. An admin or the
owning, currently assigned teacher can choose a guardian and create a saved template draft.
The guardian must belong to the same student/school, allow notifications, and have a valid
ASCII email address. Portal access is a separate permission and is not required.

Review the recipient, subject, text, and absence dates. Save edits before approving the
displayed revision. Switching tabs preserves unsaved text; closing requires an explicit
discard. A revision conflict retains edits. Discard local changes before refreshing the
latest saved draft. **Use template** explicitly replaces editor text and refreshes evidence;
it does not save or approve. There is one draft per follow-up/guardian, not a campaign system.

## Approval Contract

- Mutations carry expected message/action revisions and the reviewed recipient address.
- Approval verifies the immutable saved snapshot matches the draft exactly.
- Meaningful changes create a new revision and clear the current approval. Unchanged saves
  and repeated valid approvals are idempotent.
- Follow-up closure, changed evidence/policy/ownership/status revision, inactive student,
  ineligible recipient, changed contact, or lost approver authorization blocks approval.
- A historical approval remains in history, but `approval_effective` reflects current
  eligibility. Consumers must check it rather than interpreting `status: APPROVED` as sendable.
- If a contact permission is restored without changing the saved contact or action, an
  existing approval may become effective again. There is no contact-permission version log.
- A teacher must still own the action and have a current assignment. Administrators may
  review any school action. Other assigned teachers may read the drafts but cannot approve.

PostgreSQL school-row locks serialize message mutations with action/evidence updates.
Recipient/student rows are locked during mutations. Composite foreign keys prevent
cross-school draft parents and approval revisions; unique constraints prevent duplicate
action/guardian drafts and duplicate approval records. Revision/approval ORM updates and
deletes are rejected. These guards are not database-level protection against direct SQL.

## API

All paths are relative to `/api/v1/communication` and require a selected school session:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/actions/{id}` | Drafts, eligible contacts, permissions, current evidence |
| GET | `/actions/{id}/template?guardian_link_id=...` | Deterministic preview; no write |
| POST | `/actions/{id}/drafts` | Create template draft, or return existing draft |
| GET | `/drafts/{id}` | Current draft and effective approval |
| PATCH | `/drafts/{id}` | Revision-checked save |
| POST | `/drafts/{id}/approve` | Approve exact saved revision; no send |
| GET | `/drafts/{id}/history?limit=25&offset=0` | Paginated immutable snapshots |

Tenant and current student access are enforced independently on every endpoint. Guardians
cannot access drafts or approval history. Unknown or inaccessible resources return 404;
unauthorized staff mutations return 403, stale state returns 409, and ineligible contacts
return 400. Input validation rejects blank content, oversized fields, and control characters.

## Privacy And Limits

Templates copy no staff notes, audit content, timeline content, or correction/closing reasons.
Staff can edit free text and remain responsible for reviewing what they enter. Revision
snapshots retain full text and recipient details for authorized staff. Audit and staff timeline
entries contain only revision/object references, not message text or email addresses.

Tests use synthetic contacts at `example.test`. Browser fixtures are closed/deactivated and
their notification permission is revoked without deleting history. No production data,
real email, paid service, or public deployment is involved.

Notification records, explicit dispatch, worker leases/retries, ambiguous-send recovery,
delivery status, and credential-free n8n workflow export remain unimplemented. The eventual
delivery path must check approval immediately before dispatch and use an exact-revision
idempotency key. No claims of exactly-once SMTP delivery are made.
