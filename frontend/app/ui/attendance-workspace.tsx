"use client";

import { ClipboardList, History, RefreshCw } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttendanceHistory } from "./attendance-history";

type SessionPayload = {
  authenticated: boolean;
  current_school: { id: string; name: string; timezone?: string } | null;
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

function todayString(timezone = "UTC"): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
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
  const schoolDateRef = useRef("");
  const [sections, setSections] = useState<AttendanceSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const selectedSectionRef = useRef("");
  const [attendance, setAttendance] = useState<AttendanceSession | null>(null);
  const [message, setMessage] = useState("Attendance not loaded.");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"register" | "history">("register");
  const [historyRevision, setHistoryRevision] = useState(0);

  const canRecord =
    session?.authenticated &&
    session.current_school &&
    ["ADMIN", "TEACHER"].includes(session.current_role ?? "");
  const selectedSection = useMemo(
    () => sections.find((section) => section.section_id === selectedSectionId) ?? sections[0],
    [sections, selectedSectionId],
  );

  const loadRoster = useCallback(async (sectionId: string, attendanceDate: string) => {
    if (!sectionId) {
      setAttendance(null);
      return null;
    }
    const payload = await apiRequest<AttendanceSession>(
      `/attendance/sections/${sectionId}?school_date=${attendanceDate}`,
    );
    setAttendance(payload);
    setHistoryRevision((revision) => revision + 1);
    return payload;
  }, []);

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
      const attendanceDate =
        schoolDateRef.current || todayString(currentSession.current_school.timezone);
      schoolDateRef.current = attendanceDate;
      setSchoolDate(attendanceDate);
      const sectionPayload = await apiRequest<AttendanceSection[]>(
        `/attendance/sections?school_date=${attendanceDate}`,
      );
      setSections(sectionPayload);
      const nextSectionId =
        sectionPayload.find((section) => section.section_id === selectedSectionRef.current)
          ?.section_id ??
        sectionPayload[0]?.section_id ??
        "";
      selectedSectionRef.current = nextSectionId;
      setSelectedSectionId(nextSectionId);
      if (nextSectionId) {
        await loadRoster(nextSectionId, attendanceDate);
      } else {
        setAttendance(null);
      }
      setMessage("Attendance loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load attendance.");
    } finally {
      setBusy(false);
    }
  }, [loadRoster]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  function acceptAttendance(payload: AttendanceSession) {
    setAttendance(payload);
    setSections((current) =>
      current.map((section) =>
        section.section_id === payload.section_id
          ? {
              ...section,
              status: payload.status,
              total_students: payload.total_students,
              marked_count: payload.marked_count,
              absent_count: payload.absent_count,
              late_count: payload.late_count,
              excused_count: payload.excused_count,
            }
          : section,
      ),
    );
  }

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
    selectedSectionRef.current = sectionId;
    setSelectedSectionId(sectionId);
    setBusy(true);
    setMessage("Loading roster...");
    try {
      await loadRoster(sectionId, schoolDateRef.current);
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
        `/attendance/sections/${attendance.section_id}/draft?school_date=${attendance.school_date}`,
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
      acceptAttendance(payload);
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
        `/attendance/sections/${attendance.section_id}/finalize?school_date=${attendance.school_date}`,
        { method: "POST" },
      );
      acceptAttendance(payload);
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
            reason: record.correction_reason?.trim(),
          }),
        },
      );
      acceptAttendance(payload);
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
        <p id="attendance-heading" className="muted">
          Daily section registers and attendance corrections.
        </p>
        <button
          className="icon-button"
          type="button"
          onClick={loadAttendance}
          disabled={busy}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div
        className={`setup-status ${message === "Attendance loaded." ? "sr-only" : ""}`}
        aria-live="polite"
      >
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
                disabled={busy || !canRecord}
                onChange={(event) => {
                  schoolDateRef.current = event.target.value;
                  setSchoolDate(event.target.value);
                  if (event.target.value) void loadAttendance();
                }}
              />
            </label>
            <label>
              Section
              <select
                value={selectedSection?.section_id ?? ""}
                onChange={(event) => handleSectionChange(event.target.value)}
                disabled={busy || !canRecord || sections.length === 0}
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

          <div
            className="record-category-tabs attendance-view-tabs"
            role="tablist"
            aria-label="Attendance views"
          >
            {(["register", "history"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`attendance-${tab}-tab`}
                aria-selected={view === tab}
                aria-controls={`attendance-${tab}-panel`}
                tabIndex={view === tab ? 0 : -1}
                onClick={() => setView(tab)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "register"
                      : event.key === "End"
                        ? "history"
                        : view === "register"
                          ? "history"
                          : "register";
                  setView(next);
                  document.getElementById(`attendance-${next}-tab`)?.focus();
                }}
              >
                {tab === "register" ? (
                  <ClipboardList size={16} aria-hidden="true" />
                ) : (
                  <History size={16} aria-hidden="true" />
                )}
                {tab === "register" ? "Register" : "History"}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="attendance-history-panel"
            aria-labelledby="attendance-history-tab"
            hidden={view !== "history"}
          >
            {view === "history" && attendance ? (
              <AttendanceHistory
                key={`${attendance.session_id}:${attendance.school_date}:${historyRevision}`}
                sectionId={attendance.section_id}
                schoolDate={attendance.school_date}
                students={attendance.records}
              />
            ) : !attendance ? (
              <p className="muted">No attendance register selected.</p>
            ) : null}
          </div>
          <div
            role="tabpanel"
            id="attendance-register-panel"
            aria-labelledby="attendance-register-tab"
            hidden={view !== "register"}
          >
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
                          {marks
                            .filter((mark) => attendance.status !== "FINAL" || mark)
                            .map((mark) => (
                              <option key={mark || "unmarked"} value={mark}>
                                {mark || "Unmarked"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Note
                        <input
                          maxLength={500}
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
                              maxLength={500}
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
                            disabled={
                              busy ||
                              !record.record_id ||
                              !record.mark ||
                              (record.correction_reason?.trim().length ?? 0) < 3
                            }
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
          </div>
        </section>
      </div>
    </section>
  );
}
