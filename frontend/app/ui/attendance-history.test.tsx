import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceHistory } from "./attendance-history";

const students = [{ student_id: "student-1", given_name: "Sara", family_name: "Stone" }];
const correction = {
  id: "entry-1",
  operation: "attendance.corrected",
  actor_name: "Alex Teacher",
  occurred_at: "2026-10-08T09:00:00Z",
  changes: {
    student_id: "student-1",
    before_mark: "ABSENT",
    after_mark: "EXCUSED",
    note_changed: true,
    reason: "Guardian confirmed appointment",
  },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("AttendanceHistory", () => {
  it("shows correction history, actor and reason, then loads older entries", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: [correction], has_more: true }))
      .mockResolvedValueOnce(
        response({
          entries: [
            {
              ...correction,
              id: "entry-2",
              operation: "attendance.finalized",
              changes: {},
            },
          ],
          has_more: false,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    render(<AttendanceHistory sectionId="section-1" schoolDate="2026-10-08" students={students} />);
    expect(
      await screen.findByText("Sara Stone: absent to excused; note updated"),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Teacher")).toBeInTheDocument();
    expect(screen.getByText("Guardian confirmed appointment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Register finalized")).toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toContain("school_date=2026-10-08&limit=25&offset=1");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an empty state without inventing old history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ entries: [], has_more: false })));
    render(<AttendanceHistory sectionId="section-1" schoolDate="2026-10-08" students={[]} />);
    expect(await screen.findByText("No changes recorded for this register.")).toBeInTheDocument();
  });

  it("keeps history on a pagination error and retries the same page", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: [correction], has_more: true }))
      .mockResolvedValueOnce(response({ detail: "History temporarily unavailable" }, 503))
      .mockResolvedValueOnce(response({ entries: [], has_more: false }));
    vi.stubGlobal("fetch", fetch);
    render(<AttendanceHistory sectionId="section-1" schoolDate="2026-10-08" students={students} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("History temporarily unavailable");
    expect(screen.getByText("Attendance corrected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(fetch.mock.calls[2][0]).toEqual(fetch.mock.calls[1][0]);
  });

  it("aborts a history request when the selected register is unmounted", () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <AttendanceHistory sectionId="section-1" schoolDate="2026-10-08" students={[]} />,
    );
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
