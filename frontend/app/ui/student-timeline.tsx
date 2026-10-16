"use client";

import { ChevronDown, Clock3, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { sessionRequest } from "./session";

type Entry = {
  id: string;
  title: string;
  summary: string;
  occurred_at: string;
  visibility: string;
};
type Page = { entries: Entry[]; has_more: boolean };

export function StudentTimeline({ studentId }: { studentId: string }) {
  const [request, setRequest] = useState({ offset: 0 });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    sessionRequest<Page>(`/timeline/students/${studentId}?limit=25&offset=${request.offset}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setEntries((current) => (request.offset ? [...current, ...page.entries] : page.entries));
        setMore(page.has_more);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Unable to load timeline.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [studentId, request]);
  return (
    <section className="student-timeline" aria-label="Student timeline" aria-busy={loading}>
      <h3>
        <Clock3 size={17} aria-hidden="true" /> Student timeline
      </h3>
      <ol className="student-timeline-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="history-entry-heading">
              <strong>{entry.title}</strong>
              <time dateTime={entry.occurred_at}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(entry.occurred_at))}
              </time>
            </div>
            <p>{entry.summary}</p>
            {entry.visibility === "STAFF" || entry.visibility === "INTERNAL" ? (
              <small className="muted">Staff only</small>
            ) : null}
          </li>
        ))}
      </ol>
      {loading ? (
        <p role="status" className="muted">
          Loading timeline...
        </p>
      ) : null}
      {!loading && !error && !entries.length ? (
        <p className="muted">No timeline entries yet.</p>
      ) : null}
      {error ? (
        <div className="history-error">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRequest({ offset: request.offset })}
          >
            <RefreshCw size={15} /> Retry timeline
          </button>
        </div>
      ) : more ? (
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRequest({ offset: entries.length });
          }}
        >
          <ChevronDown size={15} /> Older entries
        </button>
      ) : null}
    </section>
  );
}
