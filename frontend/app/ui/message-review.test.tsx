import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MessageDraft, MessageReview } from "./message-review";

const draft: MessageDraft = {
  id: "draft-1",
  guardian_link_id: "link-1",
  recipient_name: "Alex Parent",
  recipient_email: "parent@example.test",
  subject: "Attendance follow-up: Sara",
  body: "Hello Alex, Sara was absent on 2026-10-07.",
  revision: 1,
  action_revision: 3,
  current_action_revision: 3,
  approval_effective: false,
  approved_revision: null,
  approved_by_name: null,
  approved_at: null,
  blocking_reason: null,
};
const workspace = {
  drafts: [draft],
  recipients: [{ guardian_link_id: "link-1", name: "Alex Parent", email: "parent@example.test" }],
  can_manage: true,
  blocking_reason: null,
  current_action_revision: 3,
  evidence_dates: ["2026-10-07"],
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function mount() {
  const onBusyChange = vi.fn();
  const onDirtyChange = vi.fn();
  render(
    <MessageReview
      actionId="action-1"
      actionRevision={3}
      onBusyChange={onBusyChange}
      onDirtyChange={onDirtyChange}
    />,
  );
  return { onBusyChange, onDirtyChange };
}
beforeEach(() => {
  vi.unstubAllGlobals();
  let stored = { ...draft };
  vi.stubGlobal(
    "fetch",
    vi.fn((url, init) => {
      const path = String(url);
      if (path.endsWith("/communication/actions/action-1")) return Promise.resolve(json(workspace));
      if (path.endsWith("/drafts/draft-1") && init?.method === "PATCH") {
        const payload = JSON.parse(init.body);
        stored = {
          ...stored,
          subject: payload.subject.trim(),
          body: payload.body.trim(),
          revision: stored.revision + 1,
          action_revision: payload.expected_action_revision,
          current_action_revision: payload.expected_action_revision,
          approval_effective: false,
          approved_revision: null,
          approved_by_name: null,
          approved_at: null,
        };
        return Promise.resolve(json(stored));
      }
      if (path.endsWith("/drafts/draft-1/approve")) {
        const payload = JSON.parse(init.body);
        stored = {
          ...stored,
          revision: payload.expected_revision,
          approval_effective: true,
          approved_revision: payload.expected_revision,
          approved_by_name: "Alex Teacher",
          approved_at: "2026-10-08T08:00:00Z",
        };
        return Promise.resolve(json(stored));
      }
      if (path.endsWith("/actions/action-1/drafts")) return Promise.resolve(json(draft, 201));
      if (path.includes("/template?"))
        return Promise.resolve(
          json({
            ...draft,
            body: "Fresh template text.",
            current_action_revision: 4,
            evidence_dates: ["2026-10-08"],
          }),
        );
      if (path.includes("/history?"))
        return Promise.resolve(
          json({
            revisions: [
              { ...draft, author_name: "Alex Teacher", created_at: "2026-10-08T08:00:00Z" },
            ],
            has_more: false,
          }),
        );
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

describe("MessageReview", () => {
  it("creates a draft only for an eligible selected contact with an evidence revision", async () => {
    const original = vi.mocked(fetch).getMockImplementation();
    if (!original) throw new Error("Missing fetch mock");
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url).endsWith("/communication/actions/action-1")
        ? Promise.resolve(json({ ...workspace, drafts: [] }))
        : original(url, init),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create draft" }));
    expect(await screen.findByRole("textbox", { name: "Subject" })).toHaveValue(draft.subject);
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      guardian_link_id: "link-1",
      recipient_email: draft.recipient_email,
      expected_action_revision: 3,
    });
    expect(screen.getByText("Revision 1 / Not sent")).toBeInTheDocument();
  });

  it("saves edits before approval and passes both expected revisions", async () => {
    const callbacks = mount();
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "Message" });
    await user.type(screen.getByRole("textbox", { name: "Message" }), " Please contact us.");
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh messages" })).toBeDisabled();
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    await user.click(await screen.findByRole("button", { name: "Approve revision 2" }));
    expect(await screen.findByText("Approved", { exact: true })).toBeInTheDocument();
    const calls = vi.mocked(fetch).mock.calls;
    const save = calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(save?.[1]?.body))).toMatchObject({
      expected_revision: 1,
      expected_action_revision: 3,
      body: `${draft.body} Please contact us.`,
    });
    const approve = calls.find(([url]) => String(url).endsWith("/approve"));
    expect(JSON.parse(String(approve?.[1]?.body))).toMatchObject({
      expected_revision: 2,
      expected_action_revision: 3,
      recipient_email: draft.recipient_email,
    });
    expect(calls.some(([url]) => /\/send|\/notifications|n8n/.test(String(url)))).toBe(false);
    expect(callbacks.onBusyChange).toHaveBeenCalledWith(true);
    expect(callbacks.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      `${draft.body} Please contact us.`,
    );
    await user.type(screen.getByRole("textbox", { name: "Message" }), " Updated.");
    expect(screen.getByRole("button", { name: "Approve revision 2" })).toBeDisabled();
    expect(screen.queryByText("Approved", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByText("Draft", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve revision 3" })).toBeEnabled();
  });

  it("retains unsaved text on a conflict and requires discard before refresh", async () => {
    const original = vi.mocked(fetch).getMockImplementation();
    if (!original) throw new Error("Missing fetch mock");
    vi.mocked(fetch).mockImplementation((url, init) =>
      init?.method === "PATCH"
        ? Promise.resolve(json({ detail: "Message changed. Refresh it before saving again." }, 409))
        : original(url, init),
    );
    mount();
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "Message" });
    await user.clear(input);
    await user.type(input, "Keep this unsaved message.");
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Message changed");
    expect(input).toHaveValue("Keep this unsaved message.");
    expect(screen.getByRole("button", { name: "Refresh messages" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(input).toHaveValue(draft.body);
    await user.click(screen.getByRole("button", { name: "Refresh messages" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("refreshes template text and evidence explicitly, without saving or approving", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Use template" }));
    expect(await screen.findByDisplayValue("Fresh template text.")).toBeInTheDocument();
    expect(screen.getByText("Attendance evidence / Follow-up revision 4")).toBeInTheDocument();
    expect(screen.getByText("2026-10-08")).toBeInTheDocument();
    expect(screen.queryByText("2026-10-07")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(call?.[1]?.body)).expected_action_revision).toBe(4);
  });

  it("disables old approval when the current recipient has changed", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        ...workspace,
        drafts: [
          {
            ...draft,
            approval_effective: false,
            approved_revision: 1,
            blocking_reason: "Guardian contact changed.",
          },
        ],
        recipients: [{ ...workspace.recipients[0], email: "new@example.test" }],
      }),
    );
    mount();
    await screen.findByText("new@example.test");
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save revision" })).toBeEnabled();
  });

  it("exposes no creation control without eligible guardian contacts", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ...workspace, drafts: [], recipients: [] }));
    mount();
    expect(await screen.findByText("No eligible guardian contacts.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create draft" })).not.toBeInTheDocument();
  });

  it("keeps closed or unclaimed follow-ups read only", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        ...workspace,
        can_manage: false,
        blocking_reason: "Claim this follow-up before drafting or approving messages.",
      }),
    );
    mount();
    expect(await screen.findByText(/Claim this follow-up/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Subject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
  });

  it("loads immutable revision history on demand and paginates older revisions", async () => {
    const original = vi.mocked(fetch).getMockImplementation();
    if (!original) throw new Error("Missing fetch mock");
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url).includes("/history?")
        ? Promise.resolve(
            json({
              revisions: [
                {
                  ...draft,
                  revision: String(url).includes("offset=0") ? 2 : 1,
                  author_name: "Alex Teacher",
                  created_at: "2026-10-08T08:00:00Z",
                  body: "Saved snapshot.",
                },
              ],
              has_more: String(url).includes("offset=0"),
            }),
          )
        : original(url, init),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Revision history" }));
    const history = within(await screen.findByRole("region", { name: "Message revision history" }));
    expect(await history.findByText("Revision 2")).toBeInTheDocument();
    await user.click(history.getByRole("button", { name: "Older revisions" }));
    expect(await history.findByText("Revision 1")).toBeInTheDocument();
    expect(history.getAllByText("Saved snapshot.")).toHaveLength(2);
  });

  it("retries an initial load failure", async () => {
    const original = vi.mocked(fetch).getMockImplementation();
    if (!original) throw new Error("Missing fetch mock");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Connection unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh messages" }));
    expect(await screen.findByRole("textbox", { name: "Subject" })).toBeInTheDocument();
  });

  it("rejects blank or control-character text before making a save request", async () => {
    mount();
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "Invalid\u0000text" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("without control characters");
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
});
