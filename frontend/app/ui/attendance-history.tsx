"use client";

import { ChevronDown, History, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { sessionRequest } from "./session";

type RecordChange = {
  student_id: string;
  before_mark: string | null;
  after_mark: string | null;
  note_changed: boolean;
};

type HistoryEntry = {
  id: string;
  operation: string;
  actor_name: string | null;
  occurred_at: string;
  changes: Partial<RecordChange> & { reason?: string; records?: RecordChange[] };
};

type HistoryPage = { entries: HistoryEntry[]; has_more: boolean };
type Props = {
  sectionId: string;
  schoolDate: string;
  students: { student_id: string; given_name: string; family_name: string }[];
};

const operationLabels: Record<string, string> = {
  "attendance.draft_saved": "Draft saved",
  "attendance.finalized": "Register finalized",
  "attendance.corrected": "Attendance corrected",
};

export function AttendanceHistory({ sectionId, schoolDate, students }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [request, setRequest] = useState({ offset: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    sessionRequest<HistoryPage>(
      `/attendance/sections/${sectionId}/history?school_date=${schoolDate}&limit=25&offset=${request.offset}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setEntries((current) =>
          request.offset === 0 ? page.entries : [...current, ...page.entries],
        );
        setHasMore(page.has_more);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Unable to load history.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sectionId, schoolDate, request]);

  function changeLabel(change: Partial<RecordChange>) {
    const student = students.find((item) => item.student_id === change.student_id);
    const name = student ? `${student.given_name} ${student.family_name}` : "Attendance record";
    const mark = (value: string | null | undefined) => value?.toLowerCase() ?? "unmarked";
    return `${name}: ${mark(change.before_mark)} to ${mark(change.after_mark)}${change.note_changed ? "; note updated" : ""}`;
  }

  return (
    <div className="attendance-history" aria-busy={loading}>
      <h4>
        <History size={16} aria-hidden="true" /> Register history
      </h4>
      {entries.length > 0 ? (
        <ol className="attendance-history-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div className="history-entry-heading">
                <strong>{operationLabels[entry.operation] ?? "Attendance updated"}</strong>
                <time dateTime={entry.occurred_at}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(entry.occurred_at))}
                </time>
              </div>
              <p className="muted">{entry.actor_name ?? "Former staff member"}</p>
              {entry.changes.student_id ? <p>{changeLabel(entry.changes)}</p> : null}
              {entry.changes.records?.map((change) => (
                <p key={change.student_id}>{changeLabel(change)}</p>
              ))}
              {entry.changes.reason ? (
                <p className="history-reason">{entry.changes.reason}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : !loading && !error ? (
        <p className="muted">No changes recorded for this register.</p>
      ) : null}
      {loading ? (
        <p className="muted" role="status">
          Loading history...
        </p>
      ) : null}
      {error ? (
        <div className="history-error">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRequest({ offset: request.offset })}
          >
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : hasMore ? (
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRequest({ offset: entries.length });
          }}
        >
          <ChevronDown size={15} aria-hidden="true" /> Load more
        </button>
      ) : null}
    </div>
  );
}
