"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  School,
  Search,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { SetupPayload, TeacherUser } from "./school-setup-workspace";
import { sessionRequest } from "./session";
import { WorkspaceDialog } from "./workspace-dialog";

const categories = [
  {
    collection: "sections",
    label: "Sections",
    singular: "section",
    endpoint: "sections",
    icon: School,
  },
  {
    collection: "academic_years",
    label: "Academic years",
    singular: "academic year",
    endpoint: "academic-years",
    icon: CalendarDays,
  },
  {
    collection: "grade_levels",
    label: "Grade levels",
    singular: "grade level",
    endpoint: "grade-levels",
    icon: Layers,
  },
  {
    collection: "subjects",
    label: "Subjects",
    singular: "subject",
    endpoint: "subjects",
    icon: BookOpen,
  },
  {
    collection: "teacher_assignments",
    label: "Teaching assignments",
    singular: "teaching assignment",
    endpoint: "teacher-assignments",
    icon: UsersRound,
  },
] as const;

type Category = (typeof categories)[number];
type Collection = Category["collection"];
type AcademicRecord = SetupPayload[Collection][number];
type Field = {
  name: string;
  label: string;
  type?: "date" | "number";
  options?: { id: string; label: string }[];
  optional?: boolean;
};
type Editor = { category: Category; record: AcademicRecord | null };

function recordField(record: AcademicRecord | null, name: string): string {
  const value: unknown = record ? Reflect.get(record, name) : undefined;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function recordName(record: AcademicRecord, teachers: TeacherUser[]): string {
  return (
    recordField(record, "name") ||
    recordField(record, "label") ||
    teachers.find((teacher) => teacher.id === recordField(record, "teacher_user_id"))
      ?.display_name ||
    "Teaching assignment"
  );
}

function editorFields(category: Category, setup: SetupPayload, teachers: TeacherUser[]): Field[] {
  const years = setup.academic_years.map((year) => ({ id: year.id, label: year.name }));
  const grades = setup.grade_levels.map((grade) => ({ id: grade.id, label: grade.label }));
  const sections = setup.sections.map((section) => ({ id: section.id, label: section.label }));
  switch (category.collection) {
    case "academic_years":
      return [
        { name: "name", label: "Name" },
        { name: "starts_on", label: "Starts", type: "date" },
        { name: "ends_on", label: "Ends", type: "date" },
      ];
    case "grade_levels":
      return [
        { name: "label", label: "Label" },
        { name: "sort_order", label: "Order", type: "number" },
      ];
    case "sections":
      return [
        { name: "label", label: "Label" },
        { name: "academic_year_id", label: "Academic year", options: years },
        { name: "grade_level_id", label: "Grade level", options: grades },
      ];
    case "subjects":
      return [{ name: "name", label: "Name" }];
    case "teacher_assignments":
      return [
        {
          name: "teacher_user_id",
          label: "Teacher",
          options: teachers.map((teacher) => ({ id: teacher.id, label: teacher.display_name })),
        },
        { name: "section_id", label: "Section", options: sections },
        {
          name: "subject_id",
          label: "Subject",
          options: setup.subjects.map((subject) => ({ id: subject.id, label: subject.name })),
          optional: true,
        },
      ];
  }
}

function recordDetail(record: AcademicRecord, setup: SetupPayload): string {
  if ("starts_on" in record) return `${record.starts_on} to ${record.ends_on}`;
  if ("sort_order" in record) return `Order ${record.sort_order}`;
  if ("academic_year_id" in record)
    return [
      setup.grade_levels.find((grade) => grade.id === record.grade_level_id)?.label,
      setup.academic_years.find((year) => year.id === record.academic_year_id)?.name,
    ]
      .filter(Boolean)
      .join(" / ");
  if ("teacher_user_id" in record)
    return [
      setup.sections.find((section) => section.id === record.section_id)?.label,
      setup.subjects.find((subject) => subject.id === record.subject_id)?.name || "All subjects",
    ]
      .filter(Boolean)
      .join(" / ");
  return "School subject";
}

export function AcademicRecords() {
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const [category, setCategory] = useState<Category>(categories[0]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    void refresh;
    setLoadError("");
    Promise.all([
      sessionRequest<SetupPayload>("/academics/setup"),
      sessionRequest<TeacherUser[]>("/students/users/teachers"),
    ])
      .then(([payload, staff]) => {
        if (active) {
          setSetup(payload);
          setTeachers(staff);
        }
      })
      .catch(() => {
        if (active) setLoadError("Academic records could not be loaded. Please try again.");
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  function openEditor(record: AcademicRecord | null) {
    setSaveError("");
    setEditor({ category, record });
  }
  function closeEditor() {
    if (!busy) setEditor(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !setup) return;
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string | number | null> = {};
    for (const field of editorFields(editor.category, setup, teachers)) {
      const value = String(form.get(field.name) ?? "");
      payload[field.name] =
        field.type === "number" ? Number(value) : field.optional && !value ? null : value;
    }
    if (editor.record) payload.status = String(form.get("status"));
    await mutate(editor, editor.record ? "PATCH" : "POST", payload);
  }

  async function mutate(
    target: Editor,
    method: "POST" | "PATCH",
    payload: Record<string, string | number | null>,
    deactivate = false,
  ) {
    setBusy(true);
    setSaveError("");
    const path = `/academics/${target.category.endpoint}${target.record ? `/${target.record.id}` : ""}${deactivate ? "/deactivate" : ""}`;
    try {
      const saved = await sessionRequest<AcademicRecord>(path, {
        method,
        body: JSON.stringify(payload),
      });
      setSetup((current) => {
        if (!current) return current;
        const records: AcademicRecord[] = current[target.category.collection];
        return {
          ...current,
          [target.category.collection]: target.record
            ? records.map((record) => (record.id === saved.id ? saved : record))
            : [...records, saved],
        };
      });
      setEditor(null);
      setNotice(`${recordName(saved, teachers)} ${deactivate ? "deactivated" : "saved"}.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save this record.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <section className="empty-state" role="alert">
        <p>{loadError}</p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </section>
    );
  if (!setup)
    return (
      <p className="empty-state" role="status">
        Loading academic records...
      </p>
    );

  const records: AcademicRecord[] = setup[category.collection];
  const filtered = records.filter(
    (record) =>
      (!status || record.status === status) &&
      `${recordName(record, teachers)} ${recordDetail(record, setup)}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const Icon = category.icon;
  return (
    <section className="academic-records" aria-label="Academic records">
      <p className="workspace-description">
        Classes, academic structure, and teaching responsibilities.
      </p>
      <div className="record-category-tabs" role="tablist" aria-label="Academic record categories">
        {categories.map((item, index) => (
          <button
            key={item.collection}
            id={`category-${item.collection}`}
            type="button"
            role="tab"
            aria-controls="academic-record-list"
            aria-selected={category.collection === item.collection}
            tabIndex={category.collection === item.collection ? 0 : -1}
            onClick={() => {
              setCategory(item);
              setPage(0);
              setQuery("");
              setStatus("");
            }}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % categories.length;
              else if (event.key === "ArrowLeft")
                next = (index + categories.length - 1) % categories.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = categories.length - 1;
              else return;
              event.preventDefault();
              setCategory(categories[next]);
              setPage(0);
              setQuery("");
              setStatus("");
              document.getElementById(`category-${categories[next].collection}`)?.focus();
            }}
          >
            {item.label}
            <span>{setup[item.collection].length}</span>
          </button>
        ))}
      </div>
      <section
        id="academic-record-list"
        role="tabpanel"
        aria-labelledby={`category-${category.collection}`}
      >
        <div className="records-toolbar">
          <div className="record-list-title">
            <span className="metric-symbol blue">
              <Icon size={20} />
            </span>
            <div>
              <h2>{category.label}</h2>
              <p>{records.filter((record) => record.status === "ACTIVE").length} active records</p>
            </div>
          </div>
          <button className="primary-button" type="button" onClick={() => openEditor(null)}>
            <Plus size={16} />
            Add {category.singular}
          </button>
        </div>
        <div className="record-filters">
          <label className="record-search">
            <span className="sr-only">Search academic records</span>
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder={`Search ${category.label.toLowerCase()}...`}
            />
          </label>
          <label>
            <span className="sr-only">Record status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh academic records"
            title="Refresh academic records"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {notice ? (
          <p className="record-notice" role="status">
            {notice}
          </p>
        ) : null}
        <div className="table-scroll">
          <table className="data-table academic-table">
            <thead>
              <tr>
                <th>{category.collection === "teacher_assignments" ? "Teacher" : "Name"}</th>
                <th>{category.collection === "academic_years" ? "School year" : "Details"}</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id}>
                  <td>{recordName(record, teachers)}</td>
                  <td>{recordDetail(record, setup)}</td>
                  <td>
                    <span className={`status-pill ${record.status === "ACTIVE" ? "positive" : ""}`}>
                      {record.status === "ACTIVE" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Edit ${recordName(record, teachers)}`}
                      title={`Edit ${category.singular}`}
                      onClick={() => openEditor(record)}
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length ? (
          <div className="empty-state">
            <Icon size={28} />
            <p>
              {records.length
                ? "No records match your search."
                : `No ${category.label.toLowerCase()} yet.`}
            </p>
            {!records.length ? (
              <button className="text-link" type="button" onClick={() => openEditor(null)}>
                <Plus size={16} />
                Add {category.singular}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="record-pagination">
          <span>
            {filtered.length
              ? `${currentPage * 10 + 1}-${Math.min((currentPage + 1) * 10, filtered.length)} of ${filtered.length} records`
              : "0 records"}
          </span>
          <div className="pagination-controls">
            <button
              className="icon-button"
              type="button"
              title="Previous page"
              aria-label="Previous page"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              className="icon-button"
              type="button"
              title="Next page"
              aria-label="Next page"
              disabled={currentPage + 1 >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
      {editor ? (
        <WorkspaceDialog
          title={`${editor.record ? "Edit" : "Add"} ${editor.category.singular}`}
          onClose={closeEditor}
        >
          <form className="form-grid" onSubmit={save}>
            {editorFields(editor.category, setup, teachers).map((field) => (
              <label key={field.name} htmlFor={`academic-${field.name}`}>
                {field.label}
                {field.options ? (
                  <select
                    id={`academic-${field.name}`}
                    disabled={busy}
                    name={field.name}
                    defaultValue={recordField(editor.record, field.name)}
                    required={!field.optional}
                  >
                    <option value="">{field.optional ? "All subjects" : "Select an option"}</option>
                    {field.options
                      .filter((option) => {
                        const source =
                          field.name === "teacher_user_id"
                            ? undefined
                            : field.name === "academic_year_id"
                              ? setup.academic_years
                              : field.name === "grade_level_id"
                                ? setup.grade_levels
                                : field.name === "section_id"
                                  ? setup.sections
                                  : setup.subjects;
                        return (
                          !source ||
                          source.some(
                            (item) =>
                              item.id === option.id &&
                              (item.status === "ACTIVE" ||
                                item.id === recordField(editor.record, field.name)),
                          )
                        );
                      })
                      .map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    id={`academic-${field.name}`}
                    disabled={busy}
                    name={field.name}
                    type={field.type ?? "text"}
                    min={field.type === "number" ? 0 : undefined}
                    defaultValue={
                      recordField(editor.record, field.name) || (field.type === "number" ? "0" : "")
                    }
                    required
                  />
                )}
              </label>
            ))}
            {editor.record ? (
              <label>
                Status
                <select name="status" defaultValue={editor.record.status} disabled={busy}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
            ) : null}
            {saveError ? (
              <p role="alert" className="error-text">
                {saveError}
              </p>
            ) : null}
            <div className="editor-actions">
              {editor.record?.status === "ACTIVE" ? (
                <button
                  className="danger-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (editor.record) void mutate(editor, "POST", {}, true);
                  }}
                >
                  Deactivate
                </button>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={closeEditor}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </WorkspaceDialog>
      ) : null}
    </section>
  );
}
