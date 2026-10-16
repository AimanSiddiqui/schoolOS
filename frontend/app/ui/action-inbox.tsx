"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  Clock3,
  Inbox,
  Mail,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useDashboardSession } from "./dashboard-shell";
import { MessageReview } from "./message-review";
import { sessionRequest } from "./session";
import { StudentTimeline } from "./student-timeline";
import { WorkspaceDialog } from "./workspace-dialog";

type Evidence = { record_id: string; section_id: string; school_date: string };
export type ActionItem = {
  id: string;
  student_id: string;
  student_name: string;
  student_number: string;
  status: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  threshold: number;
  window_days: number;
  window_end: string;
  evidence: Evidence[];
  qualifies: boolean;
  revision: number;
  resolution_reason: string | null;
};
type ActionPage = {
  items: ActionItem[];
  total: number;
  counts: Record<string, number>;
  has_more: boolean;
};
type Policy = { enabled: boolean; threshold: number; window_days: number };
type Assignee = { id: string; display_name: string };
const labels: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};
const views = [
  { id: "ACTIVE", label: "Needs review" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "CLOSED", label: "Closed" },
  { id: "ALL", label: "All actions" },
];
const closed = (status: string) => ["RESOLVED", "DISMISSED"].includes(status);
function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function PolicyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void attempt;
    setError("");
    sessionRequest<Policy>("/actions/policy", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setPolicy(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to load rule.");
      });
    return () => controller.abort();
  }, [attempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      enabled: form.has("enabled"),
      threshold: Number(form.get("threshold")),
      window_days: Number(form.get("window_days")),
    };
    if (next.threshold > next.window_days) {
      setError("Absence threshold cannot exceed the number of calendar days.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sessionRequest<Policy>("/actions/policy", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save rule.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title="Attendance rule"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {error ? (
        <p className="record-notice" role="alert">
          {error}
        </p>
      ) : null}
      {policy ? (
        <form onSubmit={save} className="form-grid">
          <label className="rule-toggle">
            <input type="checkbox" name="enabled" defaultChecked={policy.enabled} disabled={busy} />{" "}
            Repeated-absence rule
          </label>
          <label>
            Unexcused absence threshold
            <input
              type="number"
              name="threshold"
              min={1}
              max={30}
              defaultValue={policy.threshold}
              required
              disabled={busy}
            />
          </label>
          <label>
            Calendar-day window
            <input
              type="number"
              name="window_days"
              min={1}
              max={90}
              defaultValue={policy.window_days}
              required
              disabled={busy}
            />
          </label>
          <div className="editor-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              <Check size={16} /> {busy ? "Saving..." : "Save rule"}
            </button>
          </div>
        </form>
      ) : error ? (
        <button className="secondary-button" type="button" onClick={() => setAttempt(attempt + 1)}>
          <RefreshCw size={15} /> Retry
        </button>
      ) : (
        <p role="status">Loading rule...</p>
      )}
    </WorkspaceDialog>
  );
}

function ActionDialog({
  actionId,
  onClose,
  onSaved,
}: {
  actionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const session = useDashboardSession();
  const [action, setAction] = useState<ActionItem | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [status, setStatus] = useState("OPEN");
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<"details" | "messages" | "timeline">("details");
  const [messagesVisited, setMessagesVisited] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void attempt;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const item = await sessionRequest<ActionItem>(`/actions/${actionId}`, {
          signal: controller.signal,
        });
        const people = await sessionRequest<Assignee[]>(
          `/actions/assignees?student_id=${item.student_id}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setAction(item);
        setStatus(item.status);
        setOwner(item.assignee_user_id ?? "");
        setReason("");
        setAssignees(people);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to load action.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [actionId, attempt]);
  const admin = session.current_role === "ADMIN";
  const canEdit =
    action &&
    !closed(action.status) &&
    (admin || !action.assignee_user_id || action.assignee_user_id === session.user?.id);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist(owner, status, reason);
  }
  async function persist(nextOwner: string, nextStatus: string, nextReason: string) {
    if (!action || messageBusy || messageDirty) return;
    setSaving(true);
    setError("");
    try {
      const updated = await sessionRequest<ActionItem>(`/actions/${action.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: action.revision,
          status: nextStatus,
          assignee_user_id: nextOwner || null,
          reason: nextReason.trim() || null,
        }),
      });
      setAction(updated);
      setStatus(updated.status);
      setOwner(updated.assignee_user_id ?? "");
      setReason("");
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save action.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <WorkspaceDialog
      title={action?.student_name ?? "Review follow-up"}
      onClose={() => {
        if (saving || messageBusy) return;
        if (messageDirty) setConfirmDiscard(true);
        else onClose();
      }}
    >
      {confirmDiscard && messageDirty ? (
        <div className="message-discard-confirm" role="alert">
          <p>Discard unsaved message changes?</p>
          <div className="editor-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setConfirmDiscard(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={messageBusy}
              onClick={onClose}
            >
              Discard and close
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="history-error">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={saving || loading || messageBusy || messageDirty}
            onClick={() => setAttempt(attempt + 1)}
          >
            <RefreshCw size={15} /> Refresh action
          </button>
        </div>
      ) : null}
      {loading ? (
        <p role="status">Loading follow-up...</p>
      ) : action ? (
        <>
          <div className="action-review-heading">
            <span className={`status-pill action-status-${action.status.toLowerCase()}`}>
              {labels[action.status]}
            </span>
            <span className="muted">{action.student_number}</span>
          </div>
          <div className="record-category-tabs" role="tablist" aria-label="Follow-up views">
            {(["details", "messages", "timeline"] as const).map((view, index, tabs) => (
              <button
                type="button"
                role="tab"
                key={view}
                id={`follow-up-${view}-tab`}
                aria-selected={tab === view}
                aria-controls={`follow-up-${view}-panel`}
                tabIndex={tab === view ? 0 : -1}
                disabled={saving || messageBusy}
                onClick={() => {
                  setTab(view);
                  if (view === "messages") setMessagesVisited(true);
                }}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    tabs[
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                            tabs.length
                    ];
                  setTab(next);
                  if (next === "messages") setMessagesVisited(true);
                  document.getElementById(`follow-up-${next}-tab`)?.focus();
                }}
              >
                {view === "details" ? (
                  <ClipboardCheck size={16} />
                ) : view === "messages" ? (
                  <Mail size={16} />
                ) : (
                  <Clock3 size={16} />
                )}
                {view === "details" ? "Follow-up" : view === "messages" ? "Messages" : "Timeline"}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="follow-up-messages-panel"
            aria-labelledby="follow-up-messages-tab"
            hidden={tab !== "messages"}
          >
            {messagesVisited ? (
              <MessageReview
                actionId={action.id}
                actionRevision={action.revision}
                onBusyChange={setMessageBusy}
                onDirtyChange={setMessageDirty}
              />
            ) : null}
          </div>
          <div
            role="tabpanel"
            id="follow-up-timeline-panel"
            aria-labelledby="follow-up-timeline-tab"
            hidden={tab !== "timeline"}
          >
            {tab === "timeline" ? (
              <StudentTimeline
                key={`${action.student_id}:${action.revision}`}
                studentId={action.student_id}
              />
            ) : null}
          </div>
          <div
            role="tabpanel"
            id="follow-up-details-panel"
            aria-labelledby="follow-up-details-tab"
            hidden={tab !== "details"}
          >
            <h3 className="action-reason-heading">Repeated unexcused absence</h3>
            <p className="muted">
              {action.evidence.length} of {action.threshold} dates {"\u00b7"} {action.window_days}
              -day window ending {dateLabel(action.window_end)}
            </p>
            {!action.qualifies ? (
              <p className="action-evidence-warning">Evidence no longer meets the rule.</p>
            ) : null}
            <ul className="action-evidence-list">
              {action.evidence.map((item) => (
                <li key={item.school_date}>
                  <span>{dateLabel(item.school_date)}</span>
                  <span className="absence-label">Absent</span>
                </li>
              ))}
            </ul>
            {!action.evidence.length ? (
              <p className="muted">No qualifying absence dates remain.</p>
            ) : null}
            {action.resolution_reason ? (
              <div className="action-resolution">
                <h4>Closing reason</h4>
                <p>{action.resolution_reason}</p>
              </div>
            ) : null}
            {canEdit ? (
              <form className="form-grid action-editor" onSubmit={save}>
                <label>
                  Owner
                  <select
                    value={owner}
                    onChange={(event) => setOwner(event.target.value)}
                    disabled={saving || messageBusy || messageDirty}
                  >
                    {admin ? (
                      <option value="">Unassigned</option>
                    ) : !owner ? (
                      <option value="">Unassigned</option>
                    ) : null}
                    {action.assignee_user_id &&
                    !assignees.some((person) => person.id === action.assignee_user_id) ? (
                      <option value={action.assignee_user_id}>
                        {action.assignee_name ?? "Former teacher"}
                      </option>
                    ) : null}
                    {assignees
                      .filter((person) => admin || person.id === session.user?.id)
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.display_name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    disabled={saving || messageBusy || messageDirty}
                  >
                    {Object.entries(labels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {closed(status) ? (
                  <label className="action-closing-reason">
                    Closing reason
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      minLength={3}
                      maxLength={500}
                      disabled={saving || messageBusy || messageDirty}
                      rows={3}
                    />
                  </label>
                ) : null}
                <div className="editor-actions action-closing-reason">
                  {!admin && !action.assignee_user_id ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || messageBusy || messageDirty}
                      onClick={() => void persist(session.user?.id ?? "", action.status, "")}
                    >
                      <UserRound size={16} /> Assign to me
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      saving ||
                      messageBusy ||
                      messageDirty ||
                      (!admin && !owner) ||
                      (closed(status) && reason.trim().length < 3)
                    }
                  >
                    <Check size={16} />
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>
            ) : !closed(action.status) ? (
              <p className="muted">Assigned to {action.assignee_name ?? "another teacher"}.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </WorkspaceDialog>
  );
}

export function ActionInbox() {
  const session = useDashboardSession();
  const [query, setQuery] = useState("");
  const [request, setRequest] = useState({
    status: "ACTIVE",
    owner: "ALL",
    q: "",
    offset: 0,
    refresh: 0,
  });
  const [page, setPage] = useState<ActionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const staff = ["ADMIN", "TEACHER"].includes(session.current_role ?? "");
  const refresh = () => setRequest((current) => ({ ...current, refresh: current.refresh + 1 }));
  useEffect(() => {
    if (!staff) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      status_filter: request.status,
      owner: request.owner,
      q: request.q,
      limit: "25",
      offset: String(request.offset),
    });
    sessionRequest<ActionPage>(`/actions?${params}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setPage(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to load inbox.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request, staff]);
  if (!staff) return <p role="alert">Action Inbox is available to school staff.</p>;
  return (
    <section className="action-inbox" aria-label="Action Inbox">
      <div className="records-toolbar">
        <div className="record-list-title">
          <span className="metric-symbol">
            <Inbox size={20} />
          </span>
          <div>
            <h2>Attendance follow-ups</h2>
            <p>
              {page
                ? `${page.counts.OPEN ?? 0} open \u00b7 ${page.counts.IN_PROGRESS ?? 0} in progress`
                : "School follow-ups"}
            </p>
          </div>
        </div>
        <div className="action-toolbar-controls">
          <button
            type="button"
            className="icon-button"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh inbox"
            title="Refresh inbox"
          >
            <RefreshCw size={18} />
          </button>
          {session.current_role === "ADMIN" ? (
            <button type="button" className="secondary-button" onClick={() => setPolicyOpen(true)}>
              <Settings2 size={16} /> Attendance rule
            </button>
          ) : null}
        </div>
      </div>
      <div className="record-category-tabs" role="tablist" aria-label="Inbox views">
        {views.map((view, index) => (
          <button
            type="button"
            role="tab"
            key={view.id}
            id={`inbox-${view.id}-tab`}
            aria-selected={request.status === view.id}
            aria-controls="inbox-results"
            tabIndex={request.status === view.id ? 0 : -1}
            onClick={() => setRequest({ ...request, status: view.id, offset: 0 })}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? views.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
              setRequest({ ...request, status: views[next].id, offset: 0 });
              document.getElementById(`inbox-${views[next].id}-tab`)?.focus();
            }}
          >
            {view.label}
          </button>
        ))}
      </div>
      <form
        className="record-filters action-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setRequest({ ...request, q: query.trim(), offset: 0 });
        }}
      >
        <label className="record-search">
          <span className="sr-only">Search follow-ups</span>
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Student name or number"
            maxLength={200}
          />
        </label>
        <label>
          <span className="sr-only">Filter by owner</span>
          <select
            value={request.owner}
            onChange={(event) => setRequest({ ...request, owner: event.target.value, offset: 0 })}
          >
            <option value="ALL">All owners</option>
            <option value="ME">Assigned to me</option>
            <option value="UNASSIGNED">Unassigned</option>
          </select>
        </label>
        <button
          type="submit"
          className="icon-button"
          aria-label="Search inbox"
          title="Search inbox"
        >
          <Search size={18} />
        </button>
      </form>
      <div
        id="inbox-results"
        role="tabpanel"
        aria-labelledby={`inbox-${request.status}-tab`}
        aria-busy={loading}
      >
        {error ? (
          <div className="history-error">
            <p role="alert">{error}</p>
            <button type="button" className="secondary-button" onClick={refresh}>
              <RefreshCw size={15} /> Retry inbox
            </button>
          </div>
        ) : loading ? (
          <p role="status" className="muted">
            Loading follow-ups...
          </p>
        ) : page?.items.length ? (
          <div className="action-table-scroll">
            <table className="action-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Evidence</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Review</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        type="button"
                        className="action-student-link"
                        onClick={() => setSelected(item.id)}
                      >
                        {item.student_name}
                      </button>
                      <small>{item.student_number}</small>
                    </td>
                    <td>
                      <strong>{item.evidence.length} absence dates</strong>
                      <small>{item.window_days}-day window</small>
                      {!item.qualifies ? (
                        <span className="action-evidence-warning">Rule no longer met</span>
                      ) : null}
                    </td>
                    <td>{item.assignee_name ?? "Unassigned"}</td>
                    <td>
                      <span className={`status-pill action-status-${item.status.toLowerCase()}`}>
                        {labels[item.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Review follow-up for ${item.student_name}`}
                        title="Review follow-up"
                        onClick={() => setSelected(item.id)}
                      >
                        <ArrowRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="action-empty">
            <Inbox size={28} aria-hidden="true" />
            <h3>
              {request.q || request.owner !== "ALL"
                ? "No matching follow-ups"
                : request.status === "CLOSED"
                  ? "No closed follow-ups"
                  : "No follow-ups to review"}
            </h3>
          </div>
        )}
      </div>
      {!error && !loading && page ? (
        <div className="record-pagination">
          <span>
            {page.total
              ? `${request.offset + 1}-${Math.min(request.offset + 25, page.total)} of ${page.total}`
              : "0 follow-ups"}
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="icon-button"
              disabled={!request.offset}
              aria-label="Previous page"
              title="Previous page"
              onClick={() => setRequest({ ...request, offset: Math.max(0, request.offset - 25) })}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={!page.has_more}
              aria-label="Next page"
              title="Next page"
              onClick={() => setRequest({ ...request, offset: request.offset + 25 })}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : null}
      {selected ? (
        <ActionDialog
          key={selected}
          actionId={selected}
          onClose={() => setSelected("")}
          onSaved={refresh}
        />
      ) : null}
      {policyOpen ? <PolicyDialog onClose={() => setPolicyOpen(false)} onSaved={refresh} /> : null}
    </section>
  );
}
