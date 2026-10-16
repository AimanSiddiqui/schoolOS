"use client";

import {
  CheckCheck,
  ChevronDown,
  FileText,
  History,
  Plus,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sessionRequest } from "./session";

type Recipient = { guardian_link_id: string; name: string; email: string };
export type MessageDraft = {
  id: string;
  guardian_link_id: string;
  recipient_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  revision: number;
  action_revision: number;
  current_action_revision: number;
  approval_effective: boolean;
  approved_revision: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  blocking_reason: string | null;
};
type Workspace = {
  drafts: MessageDraft[];
  recipients: Recipient[];
  can_manage: boolean;
  blocking_reason: string | null;
  current_action_revision: number;
  evidence_dates: string[];
};
type Template = {
  subject: string;
  body: string;
  recipient_name: string;
  recipient_email: string;
  current_action_revision: number;
  evidence_dates: string[];
};
type Revision = {
  revision: number;
  recipient_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  action_revision: number;
  author_name: string | null;
  created_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function MessageHistory({ draftId }: { draftId: string }) {
  const [request, setRequest] = useState({ offset: 0 });
  const [rows, setRows] = useState<Revision[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    sessionRequest<{ revisions: Revision[]; has_more: boolean }>(
      `/communication/drafts/${draftId}/history?limit=25&offset=${request.offset}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setRows((current) => (request.offset ? [...current, ...page.revisions] : page.revisions));
        setMore(page.has_more);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to load revisions.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [draftId, request]);
  return (
    <section aria-label="Message revision history" className="message-history">
      <ol className="student-timeline-list">
        {rows.map((row) => (
          <li key={row.revision}>
            <div className="history-entry-heading">
              <strong>Revision {row.revision}</strong>
              <time dateTime={row.created_at}>{timeLabel(row.created_at)}</time>
            </div>
            <p className="muted">
              {row.author_name ?? "Former staff member"} / Follow-up revision {row.action_revision}
            </p>
            <p>
              {row.recipient_name} &lt;{row.recipient_email}&gt;
            </p>
            <strong>{row.subject}</strong>
            <p className="message-body-snapshot">{row.body}</p>
            {row.approved_at ? (
              <p className="muted">
                Approved by {row.approved_by_name ?? "former staff member"} at{" "}
                {timeLabel(row.approved_at)}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {loading ? <p role="status">Loading revisions...</p> : null}
      {error ? (
        <p role="alert" className="record-notice">
          {error}
        </p>
      ) : null}
      {error || more ? (
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => setRequest({ offset: error ? request.offset : rows.length })}
        >
          {error ? <RefreshCw size={15} /> : <ChevronDown size={15} />}
          {error ? "Retry revisions" : "Older revisions"}
        </button>
      ) : null}
    </section>
  );
}

export function MessageReview({
  actionId,
  actionRevision,
  onBusyChange,
  onDirtyChange,
}: {
  actionId: string;
  actionRevision: number;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const recipient = workspace?.recipients.find((item) => item.guardian_link_id === recipientId);
  const dirty = !!draft && (subject !== draft.subject || body !== draft.body);
  const needsRebind =
    !!draft &&
    (workspace?.current_action_revision !== draft.action_revision ||
      (!!recipient &&
        (recipient.email !== draft.recipient_email || recipient.name !== draft.recipient_name)));
  const current = useRef({ draftId: "", dirty: false });
  current.current = { draftId: draft?.id ?? "", dirty };
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      onBusyChange(false);
      onDirtyChange(false);
    },
    [onBusyChange, onDirtyChange],
  );

  function adopt(item: MessageDraft | null, data: Workspace) {
    setDraft(item);
    setSubject(item?.subject ?? "");
    setBody(item?.body ?? "");
    setRecipientId(
      item?.guardian_link_id ??
        data.recipients.find(
          (person) =>
            !data.drafts.some((saved) => saved.guardian_link_id === person.guardian_link_id),
        )?.guardian_link_id ??
        "",
    );
    setHistoryOpen(false);
  }
  useEffect(() => {
    void actionRevision;
    void attempt;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    sessionRequest<Workspace>(`/communication/actions/${actionId}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted || current.current.dirty) return;
        setWorkspace(data);
        const item =
          data.drafts.find((saved) => saved.id === current.current.draftId) ??
          data.drafts[0] ??
          null;
        // Refresh only replaces a clean editor; unsaved text remains local.
        setDraft(item);
        setSubject(item?.subject ?? "");
        setBody(item?.body ?? "");
        setRecipientId(item?.guardian_link_id ?? data.recipients[0]?.guardian_link_id ?? "");
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to load messages.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [actionId, actionRevision, attempt]);

  async function mutate(operation: "create" | "save" | "approve" | "template") {
    if (!workspace || !recipient || busy) return;
    if (
      operation === "save" &&
      (!subject.trim() ||
        !body.trim() ||
        Array.from(subject).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        Array.from(body).some(
          (char) =>
            (char.charCodeAt(0) < 32 && char !== "\n" && char !== "\t") ||
            char.charCodeAt(0) === 127,
        ))
    ) {
      setError("Enter a subject and message without control characters.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (operation === "template") {
        const preview = await sessionRequest<Template>(
          `/communication/actions/${actionId}/template?guardian_link_id=${recipientId}`,
        );
        setSubject(preview.subject);
        setBody(preview.body);
        setWorkspace({
          ...workspace,
          current_action_revision: preview.current_action_revision,
          evidence_dates: preview.evidence_dates,
          recipients: workspace.recipients.map((person) =>
            person.guardian_link_id === recipientId
              ? { ...person, email: preview.recipient_email, name: preview.recipient_name }
              : person,
          ),
        });
        setNotice("Template loaded. Changes are not saved.");
        return;
      }
      const payload = {
        guardian_link_id: recipientId,
        recipient_email: recipient.email,
        expected_action_revision: workspace.current_action_revision,
        ...(draft ? { expected_revision: draft.revision } : {}),
        ...(operation === "save" ? { subject, body } : {}),
      };
      const path =
        operation === "create"
          ? `/communication/actions/${actionId}/drafts`
          : `/communication/drafts/${draft?.id}${operation === "approve" ? "/approve" : ""}`;
      const saved = await sessionRequest<MessageDraft>(path, {
        method: operation === "save" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const data = {
        ...workspace,
        drafts: [saved, ...workspace.drafts.filter((item) => item.id !== saved.id)],
      };
      setWorkspace(data);
      adopt(saved, data);
      setNotice(
        operation === "approve"
          ? `Revision ${saved.revision} approved. Not sent.`
          : `Revision ${saved.revision} saved.`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to update message.");
    } finally {
      setBusy(false);
    }
  }
  const editable = !!workspace?.can_manage && !busy && !loading;
  const unused =
    workspace?.recipients.filter(
      (person) =>
        !workspace.drafts.some((saved) => saved.guardian_link_id === person.guardian_link_id),
    ) ?? [];
  return (
    <section className="message-review" aria-label="Guardian messages" aria-busy={busy || loading}>
      <div className="message-review-heading">
        <h3>Guardian messages</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh messages"
          title="Refresh messages"
          disabled={busy || loading || dirty}
          onClick={() => {
            setNotice("");
            setAttempt(attempt + 1);
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error ? (
        <p className="record-notice" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="message-notice" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? <p role="status">Loading messages...</p> : null}
      {workspace ? (
        <>
          {workspace.blocking_reason ? (
            <p className="action-evidence-warning">{workspace.blocking_reason}</p>
          ) : null}
          {workspace.drafts.length ? (
            <div className="message-draft-picker">
              <label>
                Saved message
                <select
                  value={draft?.id ?? ""}
                  disabled={busy || loading || dirty}
                  onChange={(event) =>
                    adopt(
                      workspace.drafts.find((item) => item.id === event.target.value) ?? null,
                      workspace,
                    )
                  }
                >
                  {!draft ? <option value="">New message</option> : null}
                  {workspace.drafts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.recipient_name} / Revision {item.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={!editable || dirty || !unused.length || !draft}
                onClick={() => {
                  adopt(null, workspace);
                  setError("");
                  setNotice("");
                }}
              >
                <Plus size={15} /> New message
              </button>
            </div>
          ) : null}
          <div className="message-evidence">
            <strong>
              Attendance evidence / Follow-up revision {workspace.current_action_revision}
            </strong>
            <ul>
              {workspace.evidence_dates.map((date) => (
                <li key={date}>
                  <time dateTime={date}>{date}</time>
                </li>
              ))}
            </ul>
          </div>
          {!draft ? (
            <div className="form-grid">
              {unused.length ? (
                <>
                  <label>
                    Guardian
                    <select
                      value={recipientId}
                      disabled={!editable}
                      onChange={(event) => setRecipientId(event.target.value)}
                    >
                      {unused.map((person) => (
                        <option key={person.guardian_link_id} value={person.guardian_link_id}>
                          {person.name} / {person.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="editor-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!editable || !recipient}
                      onClick={() => void mutate("create")}
                    >
                      <Plus size={16} /> Create draft
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">
                  {workspace.recipients.length
                    ? "Every eligible guardian has a saved message."
                    : "No eligible guardian contacts."}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="message-recipient">
                <strong>To: {recipient?.name ?? draft.recipient_name}</strong>
                <span>{recipient?.email ?? draft.recipient_email}</span>
              </div>
              <div className="message-stamps">
                <span
                  className={`status-pill ${draft.approval_effective && !dirty && !needsRebind ? "message-approved" : "message-pending"}`}
                >
                  {dirty
                    ? "Unsaved changes"
                    : needsRebind
                      ? "Needs review"
                      : draft.approval_effective
                        ? "Approved"
                        : draft.blocking_reason
                          ? "Needs review"
                          : "Draft"}
                </span>
                <span className="muted">Revision {draft.revision} / Not sent</span>
              </div>
              {draft.blocking_reason ? (
                <p className="action-evidence-warning">{draft.blocking_reason}</p>
              ) : null}
              {!recipient ? (
                <p className="action-evidence-warning">
                  This guardian is no longer eligible for messages.
                </p>
              ) : null}
              {draft.approval_effective && !dirty && !needsRebind && draft.approved_at ? (
                <p className="muted message-approval">
                  Approved by {draft.approved_by_name ?? "staff"} at {timeLabel(draft.approved_at)}
                </p>
              ) : null}
              <form
                className="form-grid message-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate("save");
                }}
              >
                <label>
                  Subject
                  <input
                    value={subject}
                    maxLength={200}
                    required
                    disabled={!editable || !recipient}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    value={body}
                    maxLength={5000}
                    rows={9}
                    required
                    disabled={!editable || !recipient}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </label>
                <div className="editor-actions message-editor-tools">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!editable || !recipient}
                    onClick={() => void mutate("template")}
                  >
                    <FileText size={15} /> Use template
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !dirty}
                    onClick={() => {
                      adopt(draft, workspace);
                      setNotice("");
                    }}
                  >
                    <Undo2 size={15} /> Discard changes
                  </button>
                </div>
                <div className="editor-actions">
                  <button
                    type="submit"
                    className="secondary-button"
                    disabled={
                      !editable || !recipient || (!dirty && !needsRebind && !draft.blocking_reason)
                    }
                  >
                    <Save size={16} /> Save revision
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      !editable ||
                      !recipient ||
                      dirty ||
                      needsRebind ||
                      !!draft.blocking_reason ||
                      draft.approval_effective
                    }
                    onClick={() => void mutate("approve")}
                  >
                    <CheckCheck size={16} /> Approve revision {draft.revision}
                  </button>
                </div>
              </form>
              <button
                type="button"
                className="message-history-toggle"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                <History size={16} /> Revision history <ChevronDown size={15} />
              </button>
              {historyOpen ? (
                <MessageHistory
                  key={`${draft.id}:${draft.revision}:${draft.approved_at}`}
                  draftId={draft.id}
                />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
