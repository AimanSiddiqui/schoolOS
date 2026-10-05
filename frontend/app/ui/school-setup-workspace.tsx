"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type SessionPayload = {
  authenticated: boolean;
  current_school: { id: string; name: string } | null;
  current_role: string | null;
};

type AcademicYear = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
};

type GradeLevel = {
  id: string;
  label: string;
  sort_order: number;
};

type Section = {
  id: string;
  academic_year_id: string;
  grade_level_id: string;
  label: string;
  status: string;
};

type Subject = {
  id: string;
  name: string;
};

type TeacherAssignment = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  status: string;
};

type SetupPayload = {
  academic_years: AcademicYear[];
  grade_levels: GradeLevel[];
  sections: Section[];
  subjects: Subject[];
  teacher_assignments: TeacherAssignment[];
};

type Student = {
  id: string;
  student_number: string;
  given_name: string;
  family_name: string;
  status: string;
  enrollments: { id: string; section_id: string; starts_on: string; ends_on: string | null }[];
  guardian_links: {
    id: string;
    guardian_id: string;
    relationship: string;
    portal_access: boolean;
  }[];
};

type Guardian = {
  id: string;
  display_name: string;
  email: string;
};

type TeacherUser = {
  id: string;
  display_name: string;
  email: string;
};

const emptySetup: SetupPayload = {
  academic_years: [],
  grade_levels: [],
  sections: [],
  subjects: [],
  teacher_assignments: [],
};

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

function firstId<T extends { id: string }>(items: T[]): string {
  return items[0]?.id ?? "";
}

export function SchoolSetupWorkspace() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [setup, setSetup] = useState<SetupPayload>(emptySetup);
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [latestStudent, setLatestStudent] = useState<Student | null>(null);
  const [latestGuardian, setLatestGuardian] = useState<Guardian | null>(null);
  const [message, setMessage] = useState("Setup not loaded.");
  const [busy, setBusy] = useState(false);

  const isAdmin =
    session?.authenticated && session.current_school && session.current_role === "ADMIN";
  const firstSectionId = useMemo(() => firstId(setup.sections), [setup.sections]);

  const loadSetup = useCallback(async () => {
    setBusy(true);
    try {
      const currentSession = await apiRequest<SessionPayload>("/auth/session");
      setSession(currentSession);
      if (!currentSession.authenticated || currentSession.current_role !== "ADMIN") {
        setMessage("Admin school context required.");
        return;
      }
      const [setupPayload, teacherPayload, studentPayload] = await Promise.all([
        apiRequest<SetupPayload>("/academics/setup"),
        apiRequest<TeacherUser[]>("/students/users/teachers"),
        apiRequest<Student[]>("/students"),
      ]);
      setSetup(setupPayload);
      setTeachers(teacherPayload);
      setStudents(studentPayload);
      setMessage("Setup loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load setup.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  async function createAcademicYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("Creating academic year...", "/academics/academic-years", {
      name: form.get("name"),
      starts_on: form.get("starts_on"),
      ends_on: form.get("ends_on"),
    });
  }

  async function createGradeLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("Creating grade level...", "/academics/grade-levels", {
      label: form.get("label"),
      sort_order: Number(form.get("sort_order")),
    });
  }

  async function createSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("Creating section...", "/academics/sections", {
      academic_year_id: form.get("academic_year_id"),
      grade_level_id: form.get("grade_level_id"),
      label: form.get("label"),
    });
  }

  async function createSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("Creating subject...", "/academics/subjects", {
      name: form.get("name"),
    });
  }

  async function createTeacherAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("Assigning teacher...", "/academics/teacher-assignments", {
      teacher_user_id: form.get("teacher_user_id"),
      section_id: form.get("section_id"),
      subject_id: form.get("subject_id") || null,
    });
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit<Student>(
      "Creating student...",
      "/students",
      {
        student_number: form.get("student_number"),
        given_name: form.get("given_name"),
        family_name: form.get("family_name"),
      },
      (student) => setLatestStudent(student),
    );
  }

  async function createGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit<Guardian>(
      "Creating guardian...",
      "/students/guardians",
      {
        display_name: form.get("display_name"),
        email: form.get("email"),
      },
      (guardian) => setLatestGuardian(guardian),
    );
  }

  async function linkGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const studentId = String(form.get("student_id"));
    await submit<Student>(
      "Linking guardian...",
      `/students/${studentId}/guardians`,
      {
        guardian_id: form.get("guardian_id"),
        relationship: form.get("relationship"),
        portal_access: form.get("portal_access") === "on",
      },
      (student) => setLatestStudent(student),
    );
  }

  async function createEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("Creating enrollment...", "/students/enrollments", {
      student_id: form.get("student_id"),
      section_id: form.get("section_id"),
      starts_on: form.get("starts_on"),
    });
  }

  async function submit<T>(
    pendingMessage: string,
    path: string,
    body: Record<string, FormDataEntryValue | number | boolean | null>,
    onSuccess?: (payload: T) => void,
  ) {
    setBusy(true);
    setMessage(pendingMessage);
    try {
      const payload = await apiRequest<T>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onSuccess?.(payload);
      await loadSetup();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setup-workspace" aria-labelledby="setup-heading">
      <div className="setup-header">
        <div>
          <p className="eyebrow">Milestone 3</p>
          <h2 id="setup-heading">Academics and Directory</h2>
        </div>
        <button className="icon-button" type="button" onClick={loadSetup} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="setup-status" aria-live="polite">
        <p className="muted">{message}</p>
        {session?.current_school ? (
          <p className="context-value">{session.current_school.name}</p>
        ) : null}
      </div>

      <div className="setup-grid" aria-disabled={!isAdmin}>
        <section className="panel setup-panel" aria-labelledby="year-heading">
          <h3 id="year-heading">Academic Year</h3>
          <form className="form-grid" onSubmit={createAcademicYear}>
            <label>
              Name
              <input name="name" defaultValue="2026-2027" required />
            </label>
            <label>
              Starts
              <input name="starts_on" type="date" defaultValue="2026-09-01" required />
            </label>
            <label>
              Ends
              <input name="ends_on" type="date" defaultValue="2027-07-15" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save year
            </button>
          </form>
        </section>

        <section className="panel setup-panel" aria-labelledby="level-heading">
          <h3 id="level-heading">Grade Level</h3>
          <form className="form-grid" onSubmit={createGradeLevel}>
            <label>
              Label
              <input name="label" defaultValue="Grade 1" required />
            </label>
            <label>
              Order
              <input name="sort_order" type="number" defaultValue="1" min="0" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save level
            </button>
          </form>
        </section>

        <section className="panel setup-panel" aria-labelledby="section-heading">
          <h3 id="section-heading">Section</h3>
          <form className="form-grid" onSubmit={createSection}>
            <label>
              Year
              <select name="academic_year_id" required defaultValue={firstId(setup.academic_years)}>
                {setup.academic_years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level
              <select name="grade_level_id" required defaultValue={firstId(setup.grade_levels)}>
                {setup.grade_levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Label
              <input name="label" defaultValue="1A" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save section
            </button>
          </form>
        </section>

        <section className="panel setup-panel" aria-labelledby="subject-heading">
          <h3 id="subject-heading">Subject</h3>
          <form className="form-grid" onSubmit={createSubject}>
            <label>
              Name
              <input name="name" defaultValue="Homeroom" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save subject
            </button>
          </form>

          <form className="form-grid compact-form" onSubmit={createTeacherAssignment}>
            <label>
              Teacher
              <select name="teacher_user_id" required defaultValue={firstId(teachers)}>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Section
              <select name="section_id" required defaultValue={firstSectionId}>
                {setup.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <select name="subject_id" defaultValue={firstId(setup.subjects)}>
                {setup.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={busy || !isAdmin}>
              Assign
            </button>
          </form>
        </section>

        <section className="panel setup-panel" aria-labelledby="student-heading">
          <h3 id="student-heading">Student</h3>
          <form className="form-grid" onSubmit={createStudent}>
            <label>
              Number
              <input name="student_number" defaultValue="S-001" required />
            </label>
            <label>
              Given name
              <input name="given_name" defaultValue="Sara" required />
            </label>
            <label>
              Family name
              <input name="family_name" defaultValue="Stone" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save student
            </button>
          </form>
        </section>

        <section className="panel setup-panel" aria-labelledby="guardian-heading">
          <h3 id="guardian-heading">Guardian</h3>
          <form className="form-grid" onSubmit={createGuardian}>
            <label>
              Name
              <input name="display_name" defaultValue="Nadia Stone" required />
            </label>
            <label>
              Email
              <input name="email" type="email" defaultValue="nadia@example.test" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save guardian
            </button>
          </form>

          <form className="form-grid compact-form" onSubmit={linkGuardian}>
            <label>
              Student
              <select
                name="student_id"
                required
                defaultValue={latestStudent?.id ?? firstId(students)}
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.given_name} {student.family_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Guardian ID
              <input name="guardian_id" defaultValue={latestGuardian?.id ?? ""} required />
            </label>
            <label>
              Relationship
              <input name="relationship" defaultValue="Mother" required />
            </label>
            <label className="checkbox-row">
              <input name="portal_access" type="checkbox" defaultChecked />
              Portal access
            </label>
            <button className="secondary-button" type="submit" disabled={busy || !isAdmin}>
              Link
            </button>
          </form>
        </section>

        <section className="panel setup-panel" aria-labelledby="enrollment-heading">
          <h3 id="enrollment-heading">Enrollment</h3>
          <form className="form-grid" onSubmit={createEnrollment}>
            <label>
              Student
              <select
                name="student_id"
                required
                defaultValue={latestStudent?.id ?? firstId(students)}
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.given_name} {student.family_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Section
              <select name="section_id" required defaultValue={firstSectionId}>
                {setup.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Starts
              <input name="starts_on" type="date" defaultValue="2026-09-01" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
              Save enrollment
            </button>
          </form>
        </section>

        <section className="panel setup-panel directory-panel" aria-labelledby="directory-heading">
          <h3 id="directory-heading">Directory</h3>
          <div className="record-list">
            {students.map((student) => (
              <article key={student.id} className="record-row">
                <div>
                  <strong>
                    {student.given_name} {student.family_name}
                  </strong>
                  <p className="muted">{student.student_number}</p>
                </div>
                <span>{student.enrollments.length} enrollments</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
