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
  status: string;
};

type GradeLevel = {
  id: string;
  label: string;
  sort_order: number;
  status: string;
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
  status: string;
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
  enrollments: {
    id: string;
    section_id: string;
    section_label: string | null;
    grade_level_id: string | null;
    grade_label: string | null;
    academic_year_id: string | null;
    academic_year_name: string | null;
    starts_on: string;
    ends_on: string | null;
    status: string;
  }[];
  guardian_links: {
    id: string;
    guardian_id: string;
    guardian_display_name: string | null;
    guardian_email: string | null;
    guardian_phone: string | null;
    relationship: string;
    portal_access: boolean;
    can_receive_notifications: boolean;
    emergency_contact: boolean;
  }[];
};

type Guardian = {
  id: string;
  display_name: string;
  email: string;
  phone: string | null;
};

type TeacherUser = {
  id: string;
  display_name: string;
  email: string;
};

type WorkspaceView = "overview" | "academics" | "directory" | "profile" | "maintenance";

const workspaceTabs: { id: WorkspaceView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "academics", label: "Academic Setup" },
  { id: "directory", label: "Directory" },
  { id: "profile", label: "Student Profile" },
  { id: "maintenance", label: "Maintenance" },
];

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

function studentName(student: Student): string {
  return `${student.given_name} ${student.family_name}`;
}

function studentQueryFromForm(form: FormData): string {
  const params = new URLSearchParams();
  for (const field of ["q", "status_filter", "section_id", "grade_level_id"]) {
    const value = String(form.get(field) ?? "").trim();
    if (value) {
      params.set(field, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function submitIntent(event: FormEvent<HTMLFormElement>): string {
  const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  return submitter?.value ?? "update";
}

export function SchoolSetupWorkspace() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [setup, setSetup] = useState<SetupPayload>(emptySetup);
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [latestStudent, setLatestStudent] = useState<Student | null>(null);
  const [latestGuardian, setLatestGuardian] = useState<Guardian | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [message, setMessage] = useState("Setup not loaded.");
  const [busy, setBusy] = useState(false);

  const isAdmin =
    session?.authenticated && session.current_school && session.current_role === "ADMIN";
  const firstSectionId = useMemo(() => firstId(setup.sections), [setup.sections]);
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null,
    [students, selectedStudentId],
  );
  const activeSectionCount = setup.sections.filter((section) => section.status === "ACTIVE").length;
  const activeStudentCount = students.filter((student) => student.status === "ACTIVE").length;
  const linkedGuardianCount = students.reduce(
    (total, student) => total + student.guardian_links.length,
    0,
  );
  const activeEnrollmentCount = students.reduce(
    (total, student) =>
      total + student.enrollments.filter((enrollment) => enrollment.status === "ACTIVE").length,
    0,
  );

  const loadStudents = useCallback(async (query = "") => {
    const studentPayload = await apiRequest<Student[]>(`/students${query}`);
    setStudents(studentPayload);
    setSelectedStudentId((currentId) => {
      if (studentPayload.some((student) => student.id === currentId)) {
        return currentId;
      }
      return firstId(studentPayload);
    });
    return studentPayload;
  }, []);

  const loadSetup = useCallback(async () => {
    setBusy(true);
    try {
      const currentSession = await apiRequest<SessionPayload>("/auth/session");
      setSession(currentSession);
      if (!currentSession.authenticated || currentSession.current_role !== "ADMIN") {
        setMessage("Admin school context required.");
        return;
      }
      const [setupPayload, teacherPayload, guardianPayload] = await Promise.all([
        apiRequest<SetupPayload>("/academics/setup"),
        apiRequest<TeacherUser[]>("/students/users/teachers"),
        apiRequest<Guardian[]>("/students/guardians"),
      ]);
      setSetup(setupPayload);
      setTeachers(teacherPayload);
      setGuardians(guardianPayload);
      await loadStudents();
      setMessage("Setup loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load setup.");
    } finally {
      setBusy(false);
    }
  }, [loadStudents]);

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

  async function saveAcademicYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const yearId = String(form.get("academic_year_id"));
    if (submitIntent(event) === "deactivate") {
      await submit(
        "Deactivating academic year...",
        `/academics/academic-years/${yearId}/deactivate`,
        {},
      );
      return;
    }
    await submit(
      "Updating academic year...",
      `/academics/academic-years/${yearId}`,
      {
        name: form.get("name"),
        starts_on: form.get("starts_on"),
        ends_on: form.get("ends_on"),
        status: form.get("status"),
      },
      undefined,
      "PATCH",
    );
  }

  async function saveGradeLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const gradeLevelId = String(form.get("grade_level_id"));
    if (submitIntent(event) === "deactivate") {
      await submit(
        "Deactivating grade level...",
        `/academics/grade-levels/${gradeLevelId}/deactivate`,
        {},
      );
      return;
    }
    await submit(
      "Updating grade level...",
      `/academics/grade-levels/${gradeLevelId}`,
      {
        label: form.get("label"),
        sort_order: Number(form.get("sort_order")),
        status: form.get("status"),
      },
      undefined,
      "PATCH",
    );
  }

  async function saveSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sectionId = String(form.get("section_id"));
    if (submitIntent(event) === "deactivate") {
      await submit("Deactivating section...", `/academics/sections/${sectionId}/deactivate`, {});
      return;
    }
    await submit(
      "Updating section...",
      `/academics/sections/${sectionId}`,
      {
        academic_year_id: form.get("academic_year_id"),
        grade_level_id: form.get("grade_level_id"),
        label: form.get("label"),
        status: form.get("status"),
      },
      undefined,
      "PATCH",
    );
  }

  async function saveSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subjectId = String(form.get("subject_id"));
    if (submitIntent(event) === "deactivate") {
      await submit("Deactivating subject...", `/academics/subjects/${subjectId}/deactivate`, {});
      return;
    }
    await submit(
      "Updating subject...",
      `/academics/subjects/${subjectId}`,
      {
        name: form.get("name"),
        status: form.get("status"),
      },
      undefined,
      "PATCH",
    );
  }

  async function saveTeacherAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assignmentId = String(form.get("assignment_id"));
    if (submitIntent(event) === "deactivate") {
      await submit(
        "Deactivating teacher assignment...",
        `/academics/teacher-assignments/${assignmentId}/deactivate`,
        {},
      );
      return;
    }
    await submit(
      "Updating teacher assignment...",
      `/academics/teacher-assignments/${assignmentId}`,
      {
        teacher_user_id: form.get("teacher_user_id"),
        section_id: form.get("section_id"),
        subject_id: form.get("subject_id") || null,
        status: form.get("status"),
      },
      undefined,
      "PATCH",
    );
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
      (student) => {
        setLatestStudent(student);
        setSelectedStudentId(student.id);
      },
    );
  }

  async function updateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent) {
      setMessage("Select a student first.");
      return;
    }
    const form = new FormData(event.currentTarget);
    await submit<Student>(
      "Updating student...",
      `/students/${selectedStudent.id}`,
      {
        student_number: form.get("student_number"),
        given_name: form.get("given_name"),
        family_name: form.get("family_name"),
        status: form.get("status"),
      },
      (student) => {
        setLatestStudent(student);
        setSelectedStudentId(student.id);
      },
      "PATCH",
    );
  }

  async function deactivateStudent() {
    if (!selectedStudent) {
      setMessage("Select a student first.");
      return;
    }
    await submit<Student>(
      "Deactivating student...",
      `/students/${selectedStudent.id}/deactivate`,
      {},
      (student) => {
        setLatestStudent(student);
        setSelectedStudentId(student.id);
      },
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
      (student) => {
        setLatestStudent(student);
        setSelectedStudentId(student.id);
      },
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

  async function updateEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enrollmentId = String(form.get("enrollment_id"));
    await submit(
      "Updating enrollment...",
      `/students/enrollments/${enrollmentId}`,
      {
        section_id: form.get("section_id"),
        starts_on: form.get("starts_on"),
        ends_on: form.get("ends_on") || null,
        status: form.get("status"),
      },
      undefined,
      "PATCH",
    );
  }

  async function updateGuardianLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const guardianLinkId = String(form.get("guardian_link_id"));
    await submit(
      "Updating guardian link...",
      `/students/guardian-links/${guardianLinkId}`,
      {
        relationship: form.get("relationship"),
        portal_access: form.get("portal_access") === "on",
        can_receive_notifications: form.get("can_receive_notifications") === "on",
        emergency_contact: form.get("emergency_contact") === "on",
      },
      undefined,
      "PATCH",
    );
  }

  async function filterStudents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Filtering students...");
    try {
      await loadStudents(studentQueryFromForm(new FormData(event.currentTarget)));
      setMessage("Directory filtered.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to filter students.");
    } finally {
      setBusy(false);
    }
  }

  async function submit<T>(
    pendingMessage: string,
    path: string,
    body: Record<string, FormDataEntryValue | number | boolean | null>,
    onSuccess?: (payload: T) => void,
    method = "POST",
  ) {
    setBusy(true);
    setMessage(pendingMessage);
    try {
      const payload = await apiRequest<T>(path, {
        method,
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

      <nav className="workspace-tabs" aria-label="SchoolOS sections">
        {workspaceTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeView === tab.id ? "active" : ""}
            onClick={() => setActiveView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeView === "overview" ? (
        <div className="overview-grid">
          <section className="metric-panel">
            <p className="small-label">Students</p>
            <strong>{activeStudentCount}</strong>
            <span>active of {students.length} total</span>
          </section>
          <section className="metric-panel">
            <p className="small-label">Sections</p>
            <strong>{activeSectionCount}</strong>
            <span>active sections</span>
          </section>
          <section className="metric-panel">
            <p className="small-label">Enrollments</p>
            <strong>{activeEnrollmentCount}</strong>
            <span>active records</span>
          </section>
          <section className="metric-panel">
            <p className="small-label">Guardians</p>
            <strong>{guardians.length}</strong>
            <span>{linkedGuardianCount} student links</span>
          </section>
        </div>
      ) : null}

      <div className="setup-grid" aria-disabled={!isAdmin}>
        <section
          className={`panel setup-panel view-panel ${activeView === "academics" ? "active" : ""}`}
          aria-labelledby="year-heading"
        >
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

        <section
          className={`panel setup-panel view-panel ${activeView === "academics" ? "active" : ""}`}
          aria-labelledby="level-heading"
        >
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

        <section
          className={`panel setup-panel view-panel ${activeView === "academics" ? "active" : ""}`}
          aria-labelledby="section-heading"
        >
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

        <section
          className={`panel setup-panel view-panel ${activeView === "academics" ? "active" : ""}`}
          aria-labelledby="subject-heading"
        >
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

        <section
          className={`panel setup-panel maintenance-panel view-panel ${
            activeView === "maintenance" ? "active" : ""
          }`}
          aria-labelledby="maintenance-heading"
        >
          <h3 id="maintenance-heading">Academic Maintenance</h3>
          <form className="form-grid" onSubmit={saveAcademicYear}>
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
              Name
              <input name="name" defaultValue={setup.academic_years[0]?.name} required />
            </label>
            <label>
              Starts
              <input
                name="starts_on"
                type="date"
                defaultValue={setup.academic_years[0]?.starts_on}
                required
              />
            </label>
            <label>
              Ends
              <input
                name="ends_on"
                type="date"
                defaultValue={setup.academic_years[0]?.ends_on}
                required
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={setup.academic_years[0]?.status ?? "ACTIVE"}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                type="submit"
                value="update"
                disabled={busy || !isAdmin}
              >
                Update
              </button>
              <button
                className="danger-button"
                type="submit"
                value="deactivate"
                disabled={busy || !isAdmin}
              >
                Deactivate
              </button>
            </div>
          </form>

          <form className="form-grid compact-form" onSubmit={saveGradeLevel}>
            <label>
              Grade
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
              <input name="label" defaultValue={setup.grade_levels[0]?.label} required />
            </label>
            <label>
              Order
              <input
                name="sort_order"
                type="number"
                defaultValue={setup.grade_levels[0]?.sort_order ?? 0}
                min="0"
                required
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={setup.grade_levels[0]?.status ?? "ACTIVE"}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                type="submit"
                value="update"
                disabled={busy || !isAdmin}
              >
                Update
              </button>
              <button
                className="danger-button"
                type="submit"
                value="deactivate"
                disabled={busy || !isAdmin}
              >
                Deactivate
              </button>
            </div>
          </form>

          <form className="form-grid compact-form" onSubmit={saveSection}>
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
              Grade
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
              <input name="label" defaultValue={setup.sections[0]?.label} required />
            </label>
            <label>
              Status
              <select name="status" defaultValue={setup.sections[0]?.status ?? "ACTIVE"}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                type="submit"
                value="update"
                disabled={busy || !isAdmin}
              >
                Update
              </button>
              <button
                className="danger-button"
                type="submit"
                value="deactivate"
                disabled={busy || !isAdmin}
              >
                Deactivate
              </button>
            </div>
          </form>

          <form className="form-grid compact-form" onSubmit={saveSubject}>
            <label>
              Subject
              <select name="subject_id" required defaultValue={firstId(setup.subjects)}>
                {setup.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input name="name" defaultValue={setup.subjects[0]?.name} required />
            </label>
            <label>
              Status
              <select name="status" defaultValue={setup.subjects[0]?.status ?? "ACTIVE"}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                type="submit"
                value="update"
                disabled={busy || !isAdmin}
              >
                Update
              </button>
              <button
                className="danger-button"
                type="submit"
                value="deactivate"
                disabled={busy || !isAdmin}
              >
                Deactivate
              </button>
            </div>
          </form>

          <form className="form-grid compact-form" onSubmit={saveTeacherAssignment}>
            <label>
              Assignment
              <select
                name="assignment_id"
                required
                defaultValue={firstId(setup.teacher_assignments)}
              >
                {setup.teacher_assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
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
            <label>
              Status
              <select name="status" defaultValue={setup.teacher_assignments[0]?.status ?? "ACTIVE"}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                type="submit"
                value="update"
                disabled={busy || !isAdmin}
              >
                Update
              </button>
              <button
                className="danger-button"
                type="submit"
                value="deactivate"
                disabled={busy || !isAdmin}
              >
                Deactivate
              </button>
            </div>
          </form>
        </section>

        <section
          className={`panel setup-panel view-panel ${activeView === "directory" ? "active" : ""}`}
          aria-labelledby="student-heading"
        >
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

        <section
          className={`panel setup-panel view-panel ${activeView === "directory" ? "active" : ""}`}
          aria-labelledby="guardian-heading"
        >
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
                    {studentName(student)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Guardian
              <select
                name="guardian_id"
                required
                defaultValue={latestGuardian?.id ?? firstId(guardians)}
              >
                {guardians.map((guardian) => (
                  <option key={guardian.id} value={guardian.id}>
                    {guardian.display_name}
                  </option>
                ))}
              </select>
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

        <section
          className={`panel setup-panel view-panel ${activeView === "directory" ? "active" : ""}`}
          aria-labelledby="enrollment-heading"
        >
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
                    {studentName(student)}
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

        <section
          className={`panel setup-panel directory-panel view-panel ${
            activeView === "directory" ? "active" : ""
          }`}
          aria-labelledby="directory-heading"
        >
          <h3 id="directory-heading">Directory</h3>
          <form className="directory-filter" onSubmit={filterStudents}>
            <label>
              Search
              <input name="q" placeholder="Name or number" />
            </label>
            <label>
              Status
              <select name="status_filter" defaultValue="">
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <label>
              Section
              <select name="section_id" defaultValue="">
                <option value="">Any</option>
                {setup.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Grade
              <select name="grade_level_id" defaultValue="">
                <option value="">Any</option>
                {setup.grade_levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={busy || !isAdmin}>
              Filter
            </button>
          </form>

          <div className="record-list">
            {students.map((student) => (
              <button
                key={student.id}
                className={`record-row selectable-row ${
                  selectedStudent?.id === student.id ? "selected" : ""
                }`}
                type="button"
                onClick={() => setSelectedStudentId(student.id)}
              >
                <div>
                  <strong>{studentName(student)}</strong>
                  <p className="muted">{student.student_number}</p>
                </div>
                <span>{student.status}</span>
              </button>
            ))}
          </div>
        </section>

        <section
          className={`panel setup-panel profile-panel view-panel ${
            activeView === "profile" ? "active" : ""
          }`}
          aria-labelledby="profile-heading"
        >
          <h3 id="profile-heading">Student Profile</h3>
          {selectedStudent ? (
            <>
              <div className="profile-summary">
                <div>
                  <p className="small-label">Selected</p>
                  <p className="context-value">{studentName(selectedStudent)}</p>
                  <p className="muted">{selectedStudent.student_number}</p>
                </div>
                <span className="status-pill">{selectedStudent.status}</span>
              </div>

              <form
                key={selectedStudent.id}
                className="form-grid compact-form"
                onSubmit={updateStudent}
              >
                <label>
                  Number
                  <input
                    name="student_number"
                    defaultValue={selectedStudent.student_number}
                    required
                  />
                </label>
                <label>
                  Given name
                  <input name="given_name" defaultValue={selectedStudent.given_name} required />
                </label>
                <label>
                  Family name
                  <input name="family_name" defaultValue={selectedStudent.family_name} required />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={selectedStudent.status}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </label>
                <div className="button-row">
                  <button className="primary-button" type="submit" disabled={busy || !isAdmin}>
                    Update
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={deactivateStudent}
                    disabled={busy || !isAdmin || selectedStudent.status === "INACTIVE"}
                  >
                    Deactivate
                  </button>
                </div>
              </form>

              <div className="profile-lists">
                <div>
                  <p className="small-label">Enrollments</p>
                  {selectedStudent.enrollments.length > 0 ? (
                    <ul className="plain-list">
                      {selectedStudent.enrollments.map((enrollment) => (
                        <li key={enrollment.id}>
                          <strong>{enrollment.section_label ?? enrollment.section_id}</strong>
                          <span>
                            {enrollment.grade_label ?? "Grade"} - {enrollment.academic_year_name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No enrollments yet.</p>
                  )}
                </div>
                <div>
                  <p className="small-label">Guardians</p>
                  {selectedStudent.guardian_links.length > 0 ? (
                    <ul className="plain-list">
                      {selectedStudent.guardian_links.map((link) => (
                        <li key={link.id}>
                          <strong>{link.guardian_display_name ?? link.guardian_id}</strong>
                          <span>
                            {link.relationship} - {link.portal_access ? "Portal" : "No portal"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No guardians linked.</p>
                  )}
                </div>
              </div>

              {selectedStudent.enrollments[0] ? (
                <form
                  key={`enrollment-${selectedStudent.enrollments[0].id}`}
                  className="form-grid compact-form"
                  onSubmit={updateEnrollment}
                >
                  <input
                    name="enrollment_id"
                    type="hidden"
                    value={selectedStudent.enrollments[0].id}
                  />
                  <label>
                    Enrollment section
                    <select
                      name="section_id"
                      required
                      defaultValue={selectedStudent.enrollments[0].section_id}
                    >
                      {setup.sections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Starts
                    <input
                      name="starts_on"
                      type="date"
                      defaultValue={selectedStudent.enrollments[0].starts_on}
                      required
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      name="ends_on"
                      type="date"
                      defaultValue={selectedStudent.enrollments[0].ends_on ?? ""}
                    />
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue={selectedStudent.enrollments[0].status}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                  <button className="secondary-button" type="submit" disabled={busy || !isAdmin}>
                    Update enrollment
                  </button>
                </form>
              ) : null}

              {selectedStudent.guardian_links[0] ? (
                <form
                  key={`guardian-${selectedStudent.guardian_links[0].id}`}
                  className="form-grid compact-form"
                  onSubmit={updateGuardianLink}
                >
                  <input
                    name="guardian_link_id"
                    type="hidden"
                    value={selectedStudent.guardian_links[0].id}
                  />
                  <label>
                    Relationship
                    <input
                      name="relationship"
                      defaultValue={selectedStudent.guardian_links[0].relationship}
                      required
                    />
                  </label>
                  <label className="checkbox-row">
                    <input
                      name="portal_access"
                      type="checkbox"
                      defaultChecked={selectedStudent.guardian_links[0].portal_access}
                    />
                    Portal access
                  </label>
                  <label className="checkbox-row">
                    <input
                      name="can_receive_notifications"
                      type="checkbox"
                      defaultChecked={selectedStudent.guardian_links[0].can_receive_notifications}
                    />
                    Notifications
                  </label>
                  <label className="checkbox-row">
                    <input
                      name="emergency_contact"
                      type="checkbox"
                      defaultChecked={selectedStudent.guardian_links[0].emergency_contact}
                    />
                    Emergency contact
                  </label>
                  <button className="secondary-button" type="submit" disabled={busy || !isAdmin}>
                    Update guardian link
                  </button>
                </form>
              ) : null}
            </>
          ) : (
            <p className="muted">Create or select a student to view the profile.</p>
          )}
        </section>
      </div>
    </section>
  );
}
