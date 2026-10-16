import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcademicRecords } from "./academic-records";

const setup = {
  academic_years: [
    {
      id: "year-1",
      name: "2026-2027",
      starts_on: "2026-09-01",
      ends_on: "2027-07-15",
      status: "ACTIVE",
    },
    {
      id: "year-2",
      name: "2027-2028",
      starts_on: "2027-09-01",
      ends_on: "2028-07-15",
      status: "ACTIVE",
    },
  ],
  grade_levels: [{ id: "grade-1", label: "Grade 1", sort_order: 1, status: "ACTIVE" }],
  sections: [
    {
      id: "section-1",
      label: "1A",
      academic_year_id: "year-1",
      grade_level_id: "grade-1",
      status: "ACTIVE",
    },
    {
      id: "section-2",
      label: "1B",
      academic_year_id: "year-2",
      grade_level_id: "grade-1",
      status: "INACTIVE",
    },
  ],
  subjects: [],
  teacher_assignments: [],
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AcademicRecords", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn((path) =>
        Promise.resolve(json(String(path).endsWith("/academics/setup") ? setup : [])),
      ),
    );
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  it("opens on existing records and supports search and status filters", async () => {
    const user = userEvent.setup();
    render(<AcademicRecords />);
    expect(await screen.findByRole("cell", { name: "1A" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Label", { exact: true })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Record status"), "ACTIVE");
    expect(screen.queryByRole("cell", { name: "1B" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Search academic records"), "missing");
    expect(screen.getByText("No records match your search.")).toBeInTheDocument();
  });

  it("edits the selected record rather than the first record in the collection", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation((path, init) => {
      if (String(path).endsWith("/academics/setup")) return Promise.resolve(json(setup));
      if (init?.method === "PATCH")
        return Promise.resolve(json({ ...setup.academic_years[1], name: "2027 Autumn" }));
      return Promise.resolve(json([]));
    });
    render(<AcademicRecords />);
    await screen.findByRole("cell", { name: "1A" });
    await user.click(screen.getByRole("tab", { name: /Academic years/ }));
    await user.click(screen.getByRole("button", { name: "Edit 2027-2028" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit academic year" }));
    expect(dialog.getByLabelText("Name")).toHaveValue("2027-2028");
    expect(dialog.getByLabelText("Starts")).toHaveValue("2027-09-01");
    await user.clear(dialog.getByLabelText("Name"));
    await user.type(dialog.getByLabelText("Name"), "2027 Autumn");
    await user.click(dialog.getByRole("button", { name: "Save changes" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/backend/academics/academic-years/year-2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "2027 Autumn",
          starts_on: "2027-09-01",
          ends_on: "2028-07-15",
          status: "ACTIVE",
        }),
      }),
    );
    expect(await screen.findByRole("cell", { name: "2027 Autumn" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains creation fields after an API error and adds the saved record on retry", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.mocked(fetch).mockImplementation((path, init) => {
      if (String(path).endsWith("/academics/setup")) return Promise.resolve(json(setup));
      if (init?.method === "POST") {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? json({ detail: "Please try again" }, 503)
            : json({ ...setup.sections[0], id: "section-3", label: "1C" }, 201),
        );
      }
      return Promise.resolve(json([]));
    });
    render(<AcademicRecords />);
    await screen.findByRole("cell", { name: "1A" });
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add section" }));
    await user.type(dialog.getByLabelText("Label"), "1C");
    await user.selectOptions(dialog.getByLabelText("Academic year"), "year-1");
    await user.selectOptions(dialog.getByLabelText("Grade level"), "grade-1");
    await user.click(dialog.getByRole("button", { name: "Save changes" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Please try again");
    expect(dialog.getByLabelText("Label")).toHaveValue("1C");
    await user.click(dialog.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("cell", { name: "1C" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
