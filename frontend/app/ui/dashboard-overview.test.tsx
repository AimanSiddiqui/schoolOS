import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardOverview } from "./dashboard-overview";

const context = vi.hoisted(() => ({
  current_role: "ADMIN",
  user: { display_name: "Amina Admin" },
}));
vi.mock("./dashboard-shell", () => ({ useDashboardSession: () => context }));

const students = [
  {
    id: "s-1",
    given_name: "Sara",
    family_name: "Stone",
    student_number: "S-1",
    status: "ACTIVE",
    enrollments: [],
  },
  {
    id: "s-2",
    given_name: "Adam",
    family_name: "Stone",
    student_number: "S-2",
    status: "INACTIVE",
    enrollments: [],
  },
];
const sections = [
  {
    section_id: "c-1",
    section_label: "1A",
    grade_label: "Grade 1",
    status: "DRAFT",
    total_students: 4,
    marked_count: 3,
    absent_count: 1,
  },
];

function response(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}

describe("DashboardOverview", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    context.current_role = "ADMIN";
    vi.stubGlobal(
      "fetch",
      vi.fn((path) =>
        Promise.resolve(response(String(path).endsWith("/students") ? students : sections)),
      ),
    );
  });

  it("shows persisted counts and distinguishes roster completion from absence", async () => {
    render(<DashboardOverview />);
    const activeMetric = (await screen.findByText("Active students")).closest(
      "article",
    ) as HTMLElement;
    expect(within(activeMetric).getByText("1")).toBeInTheDocument();
    expect(within(activeMetric).getByText("2 records in your scope")).toBeInTheDocument();
    expect(screen.getByLabelText("Overall roster completion")).toHaveAttribute("value", "3");
    expect(screen.getByLabelText("Overall roster completion")).toHaveAttribute("max", "4");
    expect(screen.getByText("75%")).toBeInTheDocument();
    const absentMetric = screen.getByText("Recorded absent").closest("article") as HTMLElement;
    expect(within(absentMetric).getByText("1")).toBeInTheDocument();
  });

  it("does not invent an attendance percentage when no roster exists", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(response([])));
    render(<DashboardOverview />);
    expect(await screen.findByText("No students on today's rosters")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No student records yet.")).toBeInTheDocument();
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
  });

  it("limits guardian overview to child records without requesting staff attendance", async () => {
    context.current_role = "GUARDIAN";
    render(<DashboardOverview />);
    expect(await screen.findByRole("heading", { name: "Your children" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/backend/students", expect.anything());
    expect(screen.queryByText("Today's attendance")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Take attendance" })).not.toBeInTheDocument();
  });
});
