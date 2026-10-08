"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type SessionPayload = {
  authenticated: boolean;
  current_school: { id: string; name: string } | null;
  current_role: string | null;
};

type AttendanceSection = {
  section_id: string;
  section_label: string;
  grade_label: string | null;
  school_date: string;
  status: string;
  total_students: number;
  marked_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
};

type AttendanceRecord = {
  record_id: string | null;
  student_id: string;
  student_number: string;
  given_name: string;
  family_name: string;
  mark: string | null;
  note: string | null;
  correction_reason?: string | null;
};

type AttendanceSession = {
  session_id: string;
  section_id: string;
  section_label: string;
  grade_label: string | null;
  school_date: string;
  status: string;
  finalized_at: string | null;
  total_students: number;
  marked_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  records: AttendanceRecord[];
};

const marks = ["", "PRESENT", "ABSENT", "LATE", "EXCUSED"];

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
      }
    } catch {
      // Error bodies are optional.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function studentName(record: AttendanceRecord): string {
  return `${record.given_name} ${record.family_name}`;
}

export function AttendanceWorkspace() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [schoolDate, setSchoolDate] = useState(todayString);
  const [sections, setSections] = useState<AttendanceSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [attendance, setAttendance] = useState<AttendanceSession | null>(null);
  const [message, setMessage] = useState("Attendance not loaded.");
  const [busy, setBusy] = useState(false);

  const canRecord =
    session?.authenticated &&
    session.current_school &&
    ["ADMIN", "TEACHER"].includes(session.current_role ?? "");
  const selectedSection = useMemo(
    () => sections.find((section) => section.section_id === selectedSectionId) ?? sections[0],
    [sections, selectedSectionId],
  );

  const loadRoster = useCallback(
    async (sectionId = selectedSectionId) => {
      if (!sectionId) {
        setAttendance(null);
        return null;
      }
      const payload = await apiRequest<AttendanceSession>(
        `/attendance/sections/${sectionId}?school_date=${schoolDate}`,
      );
      setAttendance(payload);
      return payload;
    },
    [schoolDate, selectedSectionId],
  );

  const loadAttendance = useCallback(async () => {
    setBusy(true);
    setMessage("Loading attendance...");
    try {
      const currentSession = await apiRequest<SessionPayload>("/auth/session");
      setSession(currentSession);
      if (
        !currentSession.authenticated ||
        !currentSession.current_school ||
        !["ADMIN", "TEACHER"].includes(currentSession.current_role ?? "")
      ) {
        setSections([]);
        setAttendance(null);
        setMessage("Admin or teacher school context required.");
        return;
      }
      const sectionPayload = await apiRequest<AttendanceSection[]>(
        `/attendance/sections?school_date=${schoolDate}`,
      );
      setSections(sectionPayload);
      const nextSectionId =
        sectionPayload.find((section) => section.section_id === selectedSectionId)?.section_id ??
        sectionPayload[0]?.section_id ??
        "";
      setSelectedSectionId(nextSectionId);
      if (nextSectionId) {
        await loadRoster(nextSectionId);
      } else {
        setAttendance(null);
      }
      setMessage("Attendance loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load attendance.");
    } finally {
      setBusy(false);
    }
  }, [loadRoster, schoolDate, selectedSectionId]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  function updateRecord(studentId: string, updates: Partial<AttendanceRecord>) {
    setAttendance((current) => {
      if (current === null) {
        return current;
      }
      return {
        ...current,
        records: current.records.map((record) =>
          record.student_id === studentId ? { ...record, ...updates } : record,
        ),
      };
    });
  }

  async function handleDateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadAttendance();
  }

  async function handleSectionChange(sectionId: string) {
    setSelectedSectionId(sectionId);
    setBusy(true);
    setMessage("Loading roster...");
    try {
      await loadRoster(sectionId);
      setMessage("Roster loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load roster.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!attendance) {
      return;
    }
    setBusy(true);
    setMessage("Saving draft...");
    try {
      const payload = await apiRequest<AttendanceSession>(
        `/attendance/sections/${attendance.section_id}/draft?school_date=${schoolDate}`,
        {
          method: "POST",
          body: JSON.stringify({
            records: attendance.records.map((record) => ({
              student_id: record.student_id,
              mark: record.mark || null,
              note: record.note || null,
            })),
          }),
        },
      );
      setAttendance(payload);
      setMessage("Draft saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save draft.");
    } finally {
      setBusy(false);
    }
  }

  async function finalizeAttendance() {
    if (!attendance) {
      return;
    }
    setBusy(true);
    setMessage("Finalizing attendance...");
    try {
      const payload = await apiRequest<AttendanceSession>(
        `/attendance/sections/${attendance.section_id}/finalize?school_date=${schoolDate}`,
        { method: "POST" },
      );
      setAttendance(payload);
      setMessage("Attendance finalized.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to finalize attendance.");
    } finally {
      setBusy(false);
    }
  }

  async function correctRecord(record: AttendanceRecord) {
    if (!record.record_id || !attendance) {
      return;
    }
    setBusy(true);
    setMessage("Applying correction...");
    try {
      const payload = await apiRequest<AttendanceSession>(
        `/attendance/records/${record.record_id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            mark: record.mark,
            note: record.note || null,
            reason: record.correction_reason || "Attendance correction",
          }),
        },
      );
      setAttendance(payload);
      setMessage("Correction saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save correction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setup-workspace attendance-workspace" aria-labelledby="attendance-heading">
      <div className="setup-header">
        <div>
          <p className="eyebrow">Milestone 4</p>
          <h2 id="attendance-heading">Attendance</h2>
        </div>
        <button className="icon-button" type="button" onClick={loadAttendance} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="setup-status" aria-live="polite">
        <p className="muted">{message}</p>
        {session?.current_school ? (
          <p className="context-value">
            {session.current_school.name}
            {session.current_role ? ` (${session.current_role})` : ""}
          </p>
        ) : null}
      </div>

      <div className="attendance-layout" aria-disabled={!canRecord}>
        <section className="panel attendance-control-panel" aria-labelledby="attendance-controls">
          <h3 id="attendance-controls">Daily Sections</h3>
          <form className="form-grid" onSubmit={handleDateSubmit}>
            <label>
              School date
              <input
                name="school_date"
                type="date"
                value={schoolDate}
                onChange={(event) => setSchoolDate(event.target.value)}
              />
            </label>
            <label>
              Section
              <select
                value={selectedSection?.section_id ?? ""}
                onChange={(event) => handleSectionChange(event.target.value)}
                disabled={!canRecord || sections.length === 0}
              >
                {sections.length === 0 ? <option value="">No sections</option> : null}
                {sections.map((section) => (
                  <option key={section.section_id} value={section.section_id}>
                    {section.grade_label ? `${section.grade_label} ` : ""}
                    {section.section_label}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={busy || !canRecord}>
              Load date
            </button>
          </form>

          <div className="attendance-section-list">
            {sections.map((section) => (
              <button
                key={section.section_id}
                type="button"
                className={section.section_id === selectedSection?.section_id ? "active" : ""}
                onClick={() => handleSectionChange(section.section_id)}
                disabled={busy}
              >
                <span>{section.section_label}</span>
                <span>
                  {section.status} · {section.marked_count}/{section.total_students}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel attendance-roster-panel" aria-labelledby="attendance-roster">
          <div className="panel-heading">
            <h3 id="attendance-roster">Roster</h3>
            {attendance ? (
              <span className="status-pill">{attendance.status}</span>
            ) : (
              <span className="status-pill">No roster</span>
            )}
          </div>

          {attendance ? (
            <>
              <div className="attendance-metrics">
                <span>
                  {attendance.marked_count}/{attendance.total_students} marked
                </span>
                <span>{attendance.absent_count} absent</span>
                <span>{attendance.late_count} late</span>
                <span>{attendance.excused_count} excused</span>
              </div>

              <div className="attendance-records">
                {attendance.records.map((record) => (
                  <div className="attendance-record" key={record.student_id}>
                    <div>
                      <strong>{studentName(record)}</strong>
                      <span>{record.student_number}</span>
                    </div>
                    <label>
                      Mark
                      <select
                        value={record.mark ?? ""}
                        onChange={(event) =>
                          updateRecord(record.student_id, { mark: event.target.value || null })
                        }
                        disabled={busy}
                      >
                        {marks.map((mark) => (
                          <option key={mark || "unmarked"} value={mark}>
                            {mark || "Unmarked"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Note
                      <input
                        value={record.note ?? ""}
                        onChange={(event) =>
                          updateRecord(record.student_id, { note: event.target.value })
                        }
                        disabled={busy}
                      />
                    </label>
                    {attendance.status === "FINAL" ? (
                      <>
                        <label>
                          Reason
                          <input
                            value={record.correction_reason ?? ""}
                            onChange={(event) =>
                              updateRecord(record.student_id, {
                                correction_reason: event.target.value,
                              })
                            }
                            disabled={busy}
                          />
                        </label>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => correctRecord(record)}
                          disabled={busy || !record.record_id || !record.mark}
                        >
                          Correct
                        </button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="attendance-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={saveDraft}
                  disabled={busy || !canRecord || attendance.status === "FINAL"}
                >
                  Save Draft
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={finalizeAttendance}
                  disabled={busy || !canRecord || attendance.status === "FINAL"}
                >
                  Finalize
                </button>
              </div>
            </>
          ) : (
            <p className="muted">No attendance roster loaded.</p>
          )}
        </section>
      </div>
    </section>
  );
}
