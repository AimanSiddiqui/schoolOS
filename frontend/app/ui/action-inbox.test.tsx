import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionInbox, type ActionItem } from "./action-inbox";

const context = vi.hoisted(() => ({ current_role: "ADMIN", user: { id: "teacher-1" } }));
vi.mock("./dashboard-shell", () => ({ useDashboardSession: () => context }));
const action: ActionItem = {
  id: "action-1",
  student_id: "student-1",
  student_name: "Sara Stone",
  student_number: "S-001",
  status: "OPEN",
  assignee_user_id: null,
  assignee_name: null,
  threshold: 2,
  window_days: 7,
  window_end: "2026-10-07",
  evidence: [
    { record_id: "record-1", section_id: "section-1", school_date: "2026-10-01" },
    { record_id: "record-2", section_id: "section-1", school_date: "2026-10-07" },
  ],
  qualifies: true,
  revision: 1,
  resolution_reason: null,
};
const page = {
  items: [action],
  total: 1,
  counts: { OPEN: 1, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 },
  has_more: false,
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

beforeEach(() => {
  context.current_role = "ADMIN";
  vi.unstubAllGlobals();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url, init) => {
      const path = String(url);
      if (path.includes("/actions?")) return Promise.resolve(json(page));
      if (path.endsWith("/actions/action-1")) {
        if (init?.method === "PATCH") {
          const payload = JSON.parse(init.body);
          return Promise.resolve(
            json({
              ...action,
              status: payload.status,
              assignee_user_id: payload.assignee_user_id,
              revision: 2,
              resolution_reason: payload.reason,
            }),
          );
        }
        return Promise.resolve(json(action));
      }
      if (path.includes("/actions/assignees?"))
        return Promise.resolve(json([{ id: "teacher-1", display_name: "Alex Teacher" }]));
      if (path.includes("/timeline/students/"))
        return Promise.resolve(
          json({
            entries: [
              {
                id: "entry-1",
                title: "Attendance follow-up opened",
                summary: "Repeated unexcused absences need review.",
                visibility: "STAFF",
                occurred_at: "2026-10-07T08:00:00Z",
              },
            ],
            has_more: false,
          }),
        );
      if (path.endsWith("/actions/policy"))
        return Promise.resolve(json({ enabled: true, threshold: 2, window_days: 7 }));
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

describe("ActionInbox", () => {
  it("preserves message edits across tabs and asks before closing a dirty editor", async () => {
    const original = vi.mocked(fetch).getMockImplementation();
    if (!original) throw new Error("Missing fetch mock");
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url).endsWith("/communication/actions/action-1")
        ? Promise.resolve(
            json({
              drafts: [
                {
                  id: "draft-1",
                  guardian_link_id: "link-1",
                  recipient_name: "Alex Parent",
                  recipient_email: "parent@example.test",
                  subject: "Attendance follow-up",
                  body: "Saved message.",
                  revision: 1,
                  action_revision: 1,
                  current_action_revision: 1,
                  approval_effective: false,
                  approved_revision: null,
                  approved_by_name: null,
                  approved_at: null,
                  blocking_reason: null,
                },
              ],
              recipients: [
                { guardian_link_id: "link-1", name: "Alex Parent", email: "parent@example.test" },
              ],
              can_manage: true,
              blocking_reason: null,
              current_action_revision: 1,
              evidence_dates: ["2026-10-07"],
            }),
          )
        : original(url, init),
    );
    render(<ActionInbox />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sara Stone" }));
    await user.click(await screen.findByRole("tab", { name: "Messages" }));
    const input = await screen.findByRole("textbox", { name: "Message" });
    await user.type(input, " Keep this edit.");
    await user.click(screen.getByRole("tab", { name: "Follow-up" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Messages" }));
    expect(input).toHaveValue("Saved message. Keep this edit.");
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Discard unsaved message changes?");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    await user.click(screen.getByRole("button", { name: "Discard and close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists real evidence and supports server-side filters and keyboard tabs", async () => {
    render(<ActionInbox />);
    await screen.findByRole("button", { name: "Sara Stone" });
    expect(screen.getByText("2 absence dates")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Search follow-ups" }), "Sara");
    await user.click(screen.getByRole("button", { name: "Search inbox" }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("q=Sara"))).toBe(
        true,
      ),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by owner" }), "ME");
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("owner=ME"))).toBe(
        true,
      ),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Needs review" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "All actions" })).toHaveFocus();
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("status_filter=ALL")),
      ).toBe(true),
    );
  });

  it("requires a closing reason and sends the revision with changes", async () => {
    render(<ActionInbox />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Review follow-up for Sara Stone" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "Sara Stone" }));
    expect(await dialog.findByText("Repeated unexcused absence")).toBeInTheDocument();
    expect(dialog.getAllByText("Absent")).toHaveLength(2);
    await user.selectOptions(dialog.getByRole("combobox", { name: "Status" }), "RESOLVED");
    expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.type(
      dialog.getByRole("textbox", { name: "Closing reason" }),
      "Reviewed with guardian",
    );
    await user.click(dialog.getByRole("button", { name: "Save changes" }));
    expect(await dialog.findByRole("heading", { name: "Closing reason" })).toBeInTheDocument();
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      expected_revision: 1,
      status: "RESOLVED",
      reason: "Reviewed with guardian",
    });
    expect(dialog.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("retains entered reasons on a revision conflict and lets the user refresh", async () => {
    const original = vi.mocked(fetch).getMockImplementation();
    if (!original) throw new Error("Missing fetch mock");
    vi.mocked(fetch).mockImplementation((url, init) =>
      init?.method === "PATCH"
        ? Promise.resolve(json({ detail: "Action changed. Refresh it before saving again." }, 409))
        : original(url, init),
    );
    render(<ActionInbox />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sara Stone" }));
    await screen.findByText("Repeated unexcused absence");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "DISMISSED");
    await user.type(screen.getByRole("textbox", { name: "Closing reason" }), "Office reviewed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Action changed");
    expect(screen.getByRole("textbox", { name: "Closing reason" })).toHaveValue("Office reviewed");
    await user.click(screen.getByRole("button", { name: "Refresh action" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("claims unassigned work immediately for an eligible teacher", async () => {
    context.current_role = "TEACHER";
    render(<ActionInbox />);
    expect(screen.queryByRole("button", { name: "Attendance rule" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sara Stone" }));
    await user.click(await screen.findByRole("button", { name: "Assign to me" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument(),
    );
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      assignee_user_id: "teacher-1",
      expected_revision: 1,
    });
  });

  it("shows the scoped student timeline inside the review dialog", async () => {
    render(<ActionInbox />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sara Stone" }));
    await user.click(await screen.findByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("Attendance follow-up opened")).toBeInTheDocument();
    expect(screen.getByText("Staff only")).toBeInTheDocument();
  });

  it("edits the school policy and validates the window before submitting", async () => {
    render(<ActionInbox />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attendance rule" }));
    const threshold = await screen.findByRole("spinbutton", {
      name: "Unexcused absence threshold",
    });
    fireEvent.change(threshold, { target: { value: "8" } });
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    expect(screen.getByRole("alert")).toHaveTextContent("cannot exceed");
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    fireEvent.change(threshold, { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      enabled: true,
      threshold: 3,
      window_days: 7,
    });
  });

  it("shows empty and retry states without inventing actions", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ detail: "Inbox unavailable" }, 503))
      .mockResolvedValueOnce(json({ ...page, items: [], total: 0 }));
    render(<ActionInbox />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Inbox unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry inbox" }));
    expect(await screen.findByText("No follow-ups to review")).toBeInTheDocument();
  });

  it("blocks guardians without requesting staff data", () => {
    context.current_role = "GUARDIAN";
    render(<ActionInbox />);
    expect(screen.getByRole("alert")).toHaveTextContent("school staff");
    expect(fetch).not.toHaveBeenCalled();
  });
});
