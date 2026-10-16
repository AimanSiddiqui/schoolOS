import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceWorkspace } from "./attendance-workspace";

type FetchCall = Parameters<typeof fetch>;

const adminSession = {
  authenticated: true,
  current_school: { id: "school-demo", name: "Local Demo School", timezone: "Europe/Berlin" },
  current_role: "ADMIN",
};

const signedOutSession = {
  authenticated: false,
  current_school: null,
  current_role: null,
};

const sectionSummary = {
  section_id: "section-1",
  section_label: "1A",
  grade_label: "Grade 1",
  school_date: "2026-10-08",
  status: "DRAFT",
  total_students: 1,
  marked_count: 0,
  absent_count: 0,
  late_count: 0,
  excused_count: 0,
};

const rosterPayload = {
  session_id: "session-1",
  section_id: "section-1",
  section_label: "1A",
  grade_label: "Grade 1",
  school_date: "2026-10-08",
  status: "DRAFT",
  finalized_at: null,
  total_students: 1,
  marked_count: 0,
  absent_count: 0,
  late_count: 0,
  excused_count: 0,
  records: [
    {
      record_id: null,
      student_id: "student-1",
      student_number: "S-001",
      given_name: "Sara",
      family_name: "Stone",
      mark: null,
      note: null,
      correction_reason: null,
    },
  ],
};

const savedPayload = {
  ...rosterPayload,
  marked_count: 1,
  records: [{ ...rosterPayload.records[0], record_id: "record-1", mark: "PRESENT" }],
};

const finalPayload = {
  ...savedPayload,
  status: "FINAL",
  finalized_at: "2026-10-08T08:00:00Z",
};

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

describe("AttendanceWorkspace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a roster, saves a draft, and finalizes attendance", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/backend/auth/session") {
        return jsonResponse(adminSession);
      }
      if (url.startsWith("/api/backend/attendance/sections?")) {
        return jsonResponse([sectionSummary]);
      }
      if (url.startsWith("/api/backend/attendance/sections/section-1?")) {
        return jsonResponse(rosterPayload);
      }
      if (
        url.startsWith("/api/backend/attendance/sections/section-1/draft?") &&
        init?.method === "POST"
      ) {
        return jsonResponse(savedPayload);
      }
      if (
        url.startsWith("/api/backend/attendance/sections/section-1/finalize?") &&
        init?.method === "POST"
      ) {
        return jsonResponse(finalPayload);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<AttendanceWorkspace />);

    expect(await screen.findByText("Attendance loaded.")).toBeInTheDocument();
    expect(screen.getByText("Sara Stone")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/backend/auth/session"),
    ).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Mark"), { target: { value: "PRESENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(screen.getByText("Draft saved.")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Mark")).toHaveValue("PRESENT");
    const draftCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith("/api/backend/attendance/sections/section-1/draft?"),
    );
    expect(JSON.parse(String(draftCall?.[1]?.body))).toMatchObject({
      records: [{ student_id: "student-1", mark: "PRESENT" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() => {
      expect(screen.getByText("Attendance finalized.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /1A\s*FINAL/ })).toHaveTextContent("1/1");
  });

  it("requires an admin or teacher school context", async () => {
    mockFetch((url) => {
      if (url === "/api/backend/auth/session") {
        return jsonResponse(signedOutSession);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<AttendanceWorkspace />);

    expect(
      await screen.findByText("Admin or teacher school context required."),
    ).toBeInTheDocument();
  });

  it("switches to history with the keyboard and requires a correction reason", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/backend/auth/session") return jsonResponse(adminSession);
      if (url.startsWith("/api/backend/attendance/sections?"))
        return jsonResponse([sectionSummary]);
      if (url.includes("/history?")) return jsonResponse({ entries: [], has_more: false });
      if (url.includes("/records/record-1") && init?.method === "PATCH")
        return jsonResponse(finalPayload);
      if (url.startsWith("/api/backend/attendance/sections/section-1?"))
        return jsonResponse(finalPayload);
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<AttendanceWorkspace />);
    await screen.findByText("Attendance loaded.");
    expect(screen.getByRole("button", { name: "Correct" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Register" }), { key: "ArrowRight" });
    expect(await screen.findByText("No changes recorded for this register.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    fireEvent.change(screen.getByLabelText("Mark"), { target: { value: "EXCUSED" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Correct" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Guardian confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    await screen.findByText("Correction saved.");
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/records/record-1"));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      mark: "EXCUSED",
      reason: "Guardian confirmed",
    });
  });

  it("defaults to the school's local date across a UTC day boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T23:30:00Z"));
    try {
      const fetchMock = mockFetch((url) => {
        if (url === "/api/backend/auth/session") return jsonResponse(adminSession);
        if (url.startsWith("/api/backend/attendance/sections?"))
          return jsonResponse([sectionSummary]);
        if (url.startsWith("/api/backend/attendance/sections/section-1?"))
          return jsonResponse(rosterPayload);
        throw new Error(`Unexpected request: ${url}`);
      });
      render(<AttendanceWorkspace />);
      await screen.findByText("Attendance loaded.");
      expect(screen.getByLabelText("School date")).toHaveValue("2026-10-09");
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("school_date=2026-10-09")),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
