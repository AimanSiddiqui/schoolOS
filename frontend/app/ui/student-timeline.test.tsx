import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentTimeline } from "./student-timeline";

const entry = {
  id: "entry-1",
  title: "Attendance recorded",
  summary: "2026-10-07: absent",
  visibility: "GUARDIAN",
  occurred_at: "2026-10-07T08:00:00Z",
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
afterEach(() => vi.unstubAllGlobals());
describe("StudentTimeline", () => {
  it("paginates scoped entries and labels staff-only items", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ entries: [entry], has_more: true }))
      .mockResolvedValueOnce(
        json({
          entries: [{ ...entry, id: "entry-2", title: "Follow-up updated", visibility: "STAFF" }],
          has_more: false,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    render(<StudentTimeline studentId="student-1" />);
    expect(await screen.findByText("Attendance recorded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older entries" }));
    expect(await screen.findByText("Follow-up updated")).toBeInTheDocument();
    expect(screen.getByText("Staff only")).toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toContain("student-1?limit=25&offset=1");
  });
  it("can retry a failed request and display an empty timeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ detail: "Timeline unavailable" }, 503))
        .mockResolvedValueOnce(json({ entries: [], has_more: false })),
    );
    render(<StudentTimeline studentId="student-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Timeline unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry timeline" }));
    expect(await screen.findByText("No timeline entries yet.")).toBeInTheDocument();
  });
  it("aborts a request when a profile is closed", () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<StudentTimeline studentId="student-1" />);
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
