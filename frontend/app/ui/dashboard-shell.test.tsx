import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "../dashboard/account/page";
import { DashboardShell } from "./dashboard-shell";
import type { SessionPayload } from "./session";

const navigation = vi.hoisted(() => ({
  pathname: "/dashboard/attendance",
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
}));

const school = {
  id: "school-1",
  name: "Northview School",
  timezone: "Europe/Berlin",
  language: "en",
};
const signedIn: SessionPayload = {
  authenticated: true,
  user: { id: "admin-1", display_name: "Amina Admin", email: "admin@school.edu" },
  current_school: school,
  current_role: "ADMIN",
  memberships: [{ school, role: "ADMIN" }],
};
const signedOut: SessionPayload = {
  authenticated: false,
  user: null,
  current_school: null,
  current_role: null,
  memberships: [],
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DashboardShell", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    navigation.replace.mockReset();
    navigation.refresh.mockReset();
    navigation.pathname = "/dashboard/attendance";
    window.history.replaceState(null, "", navigation.pathname);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((_path, init?: RequestInit) =>
          Promise.resolve(
            init?.method === "POST" ? new Response(null, { status: 204 }) : json(signedIn),
          ),
        ),
    );
  });

  it("hides module content until the session is verified", async () => {
    let resolveSession: (response: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    render(
      <DashboardShell>
        <p>Private roster</p>
      </DashboardShell>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Opening your school");
    expect(screen.queryByText("Private roster")).not.toBeInTheDocument();
    resolveSession(json(signedIn));
    expect(await screen.findByText("Private roster")).toBeInTheDocument();
  });

  it("redirects signed-out deep links to login with a return destination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(signedOut));
    render(
      <DashboardShell>
        <p>Private roster</p>
      </DashboardShell>,
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fattendance"),
    );
    expect(screen.queryByText("Private roster")).not.toBeInTheDocument();
  });

  it("uses page links and updates the active section when the URL changes", async () => {
    const { rerender } = render(
      <DashboardShell>
        <p>Roster</p>
      </DashboardShell>,
    );
    const sidebar = await screen.findByRole("navigation", { name: "School sections" });
    expect(within(sidebar).getByRole("link", { name: /Attendance/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sidebar).getByRole("link", { name: /Academics/ })).toHaveAttribute(
      "href",
      "/dashboard/academics",
    );
    navigation.pathname = "/dashboard/academics";
    rerender(
      <DashboardShell>
        <p>Student records</p>
      </DashboardShell>,
    );
    expect(within(sidebar).getByRole("link", { name: /Academics/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sidebar).getByRole("link", { name: /Attendance/ })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Academics");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("signs out on a 204 response and clears protected content", async () => {
    render(
      <DashboardShell>
        <p>Private roster</p>
      </DashboardShell>,
    );
    await screen.findByText("Private roster");
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Log out" })[0]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/backend/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(navigation.replace).toHaveBeenCalledWith("/login");
    expect(navigation.refresh).toHaveBeenCalled();
    expect(screen.queryByText("Private roster")).not.toBeInTheDocument();
  });

  it("keeps the session visible when sign out fails and allows retry", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(signedIn))
      .mockResolvedValueOnce(json({ detail: "Unavailable" }, 503));
    render(
      <DashboardShell>
        <p>Private roster</p>
      </DashboardShell>,
    );
    await screen.findByText("Private roster");
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Log out" })[0]);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign out failed");
    expect(screen.getByText("Private roster")).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Log out" })[0]);
    expect(navigation.replace).toHaveBeenCalledWith("/login");
  });

  it("retries a failed session check without mounting protected content", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    render(
      <DashboardShell>
        <p>Private roster</p>
      </DashboardShell>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect");
    expect(screen.queryByText("Private roster")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Private roster")).toBeInTheDocument();
  });

  it("removes protected content if the session expires while away", async () => {
    render(
      <DashboardShell>
        <p>Private roster</p>
      </DashboardShell>,
    );
    await screen.findByText("Private roster");
    vi.mocked(fetch).mockResolvedValueOnce(json(signedOut));
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(screen.queryByText("Private roster")).not.toBeInTheDocument();
  });

  it("shows real profile and school details on the account page", async () => {
    navigation.pathname = "/dashboard/account";
    render(
      <DashboardShell>
        <AccountPage />
      </DashboardShell>,
    );
    expect(await screen.findByText("admin@school.edu")).toBeInTheDocument();
    expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Onboard" })).not.toBeInTheDocument();
  });

  it("shows teachers only the navigation available to their role", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...signedIn, current_role: "TEACHER" }));
    render(
      <DashboardShell>
        <p>Roster</p>
      </DashboardShell>,
    );
    const navigation = await screen.findByRole("navigation", { name: "School sections" });
    expect(within(navigation).getByRole("link", { name: "Attendance" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Action Inbox" })).toHaveAttribute(
      "href",
      "/dashboard/actions",
    );
    expect(within(navigation).queryByRole("link", { name: "Students" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Academics" })).not.toBeInTheDocument();
  });

  it("keeps the staff inbox out of guardian navigation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...signedIn, current_role: "GUARDIAN" }));
    render(
      <DashboardShell>
        <p>Guardian home</p>
      </DashboardShell>,
    );
    const navigation = await screen.findByRole("navigation", { name: "School sections" });
    expect(
      within(navigation).queryByRole("link", { name: "Action Inbox" }),
    ).not.toBeInTheDocument();
  });
});
