import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppWorkspace } from "./app-workspace";

vi.mock("./auth-workspace", () => ({
  AuthWorkspace: ({ onSessionChange }: { onSessionChange?: (session: unknown) => void }) => (
    <div>
      <div>Access module mounted</div>
      <button
        type="button"
        onClick={() =>
          onSessionChange?.({
            authenticated: true,
            user: {
              id: "user-admin",
              email: "admin@schoolos.local",
              display_name: "Amina Admin",
            },
            memberships: [],
            current_school: {
              id: "school-demo",
              name: "Local Demo School",
              timezone: "Europe/Berlin",
              language: "en",
            },
            current_role: "ADMIN",
          })
        }
      >
        Complete login
      </button>
    </div>
  ),
}));

vi.mock("./school-setup-workspace", () => ({
  SchoolSetupWorkspace: () => <div>Academics module mounted</div>,
}));

vi.mock("./attendance-workspace", () => ({
  AttendanceWorkspace: () => <div>Attendance module mounted</div>,
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AppWorkspace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            authenticated: false,
            user: null,
            memberships: [],
            current_school: null,
            current_role: null,
          }),
        ),
      ),
    );
  });

  it("moves from landing to login to a tabbed dashboard", async () => {
    const user = userEvent.setup();

    render(<AppWorkspace />);

    expect(screen.getByText("Run the school day from one calm dashboard.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Sign in to SchoolOS")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Complete login" }));

    expect(await screen.findByText("Operations Overview")).toBeInTheDocument();
    expect(screen.queryByText("Access module mounted")).not.toBeInTheDocument();
    expect(screen.queryByText("Academics module mounted")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance module mounted")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Academics/ }));

    expect(screen.getByText("Academics module mounted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Attendance/ }));

    expect(screen.queryByText("Academics module mounted")).not.toBeInTheDocument();
    expect(screen.getByText("Attendance module mounted")).toBeInTheDocument();
  });
});
