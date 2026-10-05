import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolSetupWorkspace } from "./school-setup-workspace";

type FetchCall = Parameters<typeof fetch>;

const adminSession = {
  authenticated: true,
  current_school: { id: "school-demo", name: "Local Demo School" },
  current_role: "ADMIN",
};

const teacherSession = {
  authenticated: true,
  current_school: { id: "school-demo", name: "Local Demo School" },
  current_role: "TEACHER",
};

const setupPayload = {
  academic_years: [
    { id: "year-1", name: "2026-2027", starts_on: "2026-09-01", ends_on: "2027-07-15" },
  ],
  grade_levels: [{ id: "level-1", label: "Grade 1", sort_order: 1 }],
  sections: [
    {
      id: "section-1",
      academic_year_id: "year-1",
      grade_level_id: "level-1",
      label: "1A",
      status: "ACTIVE",
    },
  ],
  subjects: [{ id: "subject-1", name: "Homeroom" }],
  teacher_assignments: [],
};

const studentsPayload = [
  {
    id: "student-1",
    student_number: "S-001",
    given_name: "Sara",
    family_name: "Stone",
    status: "ACTIVE",
    enrollments: [],
    guardian_links: [],
  },
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((...args: FetchCall) => {
    const [input, init] = args;
    return Promise.resolve(handler(String(input), init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SchoolSetupWorkspace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads setup data for an admin school context", async () => {
    mockFetch((url) => {
      if (url === "/api/backend/auth/session") {
        return jsonResponse(adminSession);
      }
      if (url === "/api/backend/academics/setup") {
        return jsonResponse(setupPayload);
      }
      if (url === "/api/backend/students/users/teachers") {
        return jsonResponse([{ id: "teacher-1", display_name: "Tariq Teacher", email: "t@test" }]);
      }
      if (url === "/api/backend/students") {
        return jsonResponse(studentsPayload);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SchoolSetupWorkspace />);

    expect(await screen.findByText("Setup loaded.")).toBeInTheDocument();
    expect(screen.getByText("Local Demo School")).toBeInTheDocument();
    const directory = screen.getByRole("region", { name: "Directory" });
    expect(within(directory).getByText("Sara Stone")).toBeInTheDocument();
    expect(within(directory).getByText("S-001")).toBeInTheDocument();
  });

  it("submits academic year creation through the API", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/backend/auth/session") {
        return jsonResponse(adminSession);
      }
      if (url === "/api/backend/academics/setup") {
        return jsonResponse(setupPayload);
      }
      if (url === "/api/backend/students/users/teachers") {
        return jsonResponse([]);
      }
      if (url === "/api/backend/students") {
        return jsonResponse([]);
      }
      if (url === "/api/backend/academics/academic-years" && init?.method === "POST") {
        return jsonResponse(setupPayload.academic_years[0], 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SchoolSetupWorkspace />);

    await screen.findByText("Setup loaded.");
    const yearPanel = screen.getByRole("region", { name: "Academic Year" });
    fireEvent.submit(within(yearPanel).getByLabelText("Name").closest("form") as HTMLFormElement);

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([url]) => url === "/api/backend/academics/academic-years",
      );
      expect(createCall).toBeDefined();
      expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
        name: "2026-2027",
        starts_on: "2026-09-01",
        ends_on: "2027-07-15",
      });
    });
  });

  it("requires an admin context", async () => {
    mockFetch((url) => {
      if (url === "/api/backend/auth/session") {
        return jsonResponse(teacherSession);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SchoolSetupWorkspace />);

    expect(await screen.findByText("Admin school context required.")).toBeInTheDocument();
  });
});
