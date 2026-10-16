"use client";

import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDashboardSession } from "./dashboard-shell";
import { sessionRequest } from "./session";

type StudentSummary = {
  id: string;
  student_number: string;
  given_name: string;
  family_name: string;
  status: string;
  enrollments: { section_label: string | null; status: string }[];
};
type SectionSummary = {
  section_id: string;
  section_label: string;
  grade_label: string | null;
  status: string;
  total_students: number;
  marked_count: number;
  absent_count: number;
  school_date: string;
};

export function DashboardOverview() {
  const session = useDashboardSession();
  const [data, setData] = useState<{
    students: StudentSummary[];
    sections: SectionSummary[];
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const isGuardian = session.current_role === "GUARDIAN";
  useEffect(() => {
    let active = true;
    void attempt;
    Promise.all([
      sessionRequest<StudentSummary[]>("/students"),
      isGuardian
        ? Promise.resolve([] as SectionSummary[])
        : sessionRequest<SectionSummary[]>("/attendance/sections"),
    ])
      .then(([students, sections]) => {
        if (active) {
          setData({ students, sections });
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("School overview could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [attempt, isGuardian]);

  if (error)
    return (
      <div className="empty-state" role="alert">
        <p>{error}</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    );
  if (!data)
    return (
      <p className="empty-state" role="status">
        Loading your school overview...
      </p>
    );

  const total = data.sections.reduce((sum, section) => sum + section.total_students, 0);
  const marked = data.sections.reduce((sum, section) => sum + section.marked_count, 0);
  const absent = data.sections.reduce((sum, section) => sum + section.absent_count, 0);
  const finalized = data.sections.filter((section) => section.status === "FINAL").length;
  const activeStudents = data.students.filter((student) => student.status === "ACTIVE").length;
  const completion = total > 0 ? Math.round((marked / total) * 100) : 0;
  const firstName = session.user?.display_name.split(" ")[0];
  return (
    <section className="dashboard-overview" aria-label="School overview details">
      <div className="overview-welcome">
        <div>
          <h2>A good day starts with a clear overview.</h2>
          <p>Welcome back, {firstName}. Here&apos;s where your school stands today.</p>
        </div>
        {!isGuardian ? (
          <Link href="/dashboard/attendance" className="primary-button">
            <ClipboardCheck size={17} />
            Take attendance
            <ArrowRight size={16} />
          </Link>
        ) : null}
      </div>
      <div className="summary-metrics">
        <article className="summary-metric">
          <span className="metric-symbol mint">
            <UsersRound size={21} />
          </span>
          <div>
            <p>{isGuardian ? "Your children" : "Active students"}</p>
            <strong>{activeStudents}</strong>
            <small>{data.students.length} records in your scope</small>
          </div>
        </article>
        {!isGuardian ? (
          <>
            <article className="summary-metric">
              <span className="metric-symbol blue">
                <BookOpen size={21} />
              </span>
              <div>
                <p>Sections today</p>
                <strong>{data.sections.length}</strong>
                <small>{finalized} finalized</small>
              </div>
            </article>
            <article className="summary-metric">
              <span className="metric-symbol lilac">
                <ClipboardCheck size={21} />
              </span>
              <div>
                <p>Roster marks</p>
                <strong>
                  {marked}
                  <span> / {total}</span>
                </strong>
                <small>
                  {total ? `${completion}% marked today` : "No students on today's rosters"}
                </small>
              </div>
            </article>
            <article className="summary-metric">
              <span className="metric-symbol amber">
                <GraduationCap size={21} />
              </span>
              <div>
                <p>Recorded absent</p>
                <strong>{absent}</strong>
                <small>Unexcused marks today</small>
              </div>
            </article>
          </>
        ) : null}
      </div>
      <div className="overview-columns">
        <section className="data-section">
          <div className="section-heading">
            <div>
              <h2>{isGuardian ? "Your children" : "Student directory"}</h2>
              <p>Student records in your school workspace</p>
            </div>
            {session.current_role === "ADMIN" ? (
              <Link className="text-link" href="/dashboard/students">
                View all
                <ArrowRight size={15} />
              </Link>
            ) : null}
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Student ID</th>
                  <th>Section</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.students.slice(0, 6).map((student) => (
                  <tr key={student.id}>
                    <td>
                      <span className="student-cell">
                        <span className="avatar student-avatar">
                          {student.given_name[0]}
                          {student.family_name[0]}
                        </span>
                        <span>
                          {student.given_name} {student.family_name}
                        </span>
                      </span>
                    </td>
                    <td>{student.student_number}</td>
                    <td>
                      {student.enrollments.find((enrollment) => enrollment.status === "ACTIVE")
                        ?.section_label ?? "Not enrolled"}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${student.status === "ACTIVE" ? "positive" : ""}`}
                      >
                        {student.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.students.length ? <p className="empty-state">No student records yet.</p> : null}
          </div>
        </section>
        {!isGuardian ? (
          <section className="data-section attendance-snapshot">
            <div className="section-heading">
              <div>
                <h2>Today&apos;s attendance</h2>
                <p>Marking progress by section</p>
              </div>
              <ClipboardCheck size={18} />
            </div>
            <div className="completion-total">
              <strong>{total ? `${completion}%` : "--"}</strong>
              <span>
                roster completion
                <small>
                  {marked} of {total} marks recorded
                </small>
              </span>
            </div>
            <progress
              className="completion-progress"
              value={marked}
              max={Math.max(total, 1)}
              aria-label="Overall roster completion"
            />
            <div className="section-progress-list">
              {data.sections.map((section) => (
                <div key={section.section_id}>
                  <div>
                    <strong>
                      {section.grade_label} {section.section_label}
                    </strong>
                    <span>
                      {section.marked_count}/{section.total_students}
                    </span>
                  </div>
                  <progress
                    value={section.marked_count}
                    max={Math.max(section.total_students, 1)}
                    aria-label={`${section.section_label} roster completion`}
                  />
                </div>
              ))}
            </div>
            {!data.sections.length ? (
              <p className="empty-state">No sections available today.</p>
            ) : null}
            <Link className="text-link" href="/dashboard/attendance">
              Open daily register
              <ArrowRight size={15} />
            </Link>
          </section>
        ) : null}
      </div>
    </section>
  );
}
