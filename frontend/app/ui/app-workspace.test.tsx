import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppWorkspace } from "./app-workspace";

vi.mock("./auth-portal", () => ({
  AuthPortal: ({
    mode,
    onSessionChange,
  }: {
    mode: "login" | "signup";
    onSessionChange?: (session: unknown) => void;
  }) => (
    <div>
      <div>{mode === "signup" ? "Signup portal mounted" : "Login portal mounted"}</div>
      <button
        type="button"
        onClick={() =>
          onSessionChange?.({
            authenticated: false,
            user: null,
            memberships: [],
            current_school: null,
            current_role: null,
          })
        }
      >
        Report signed out
      </button>
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

vi.mock("./auth-workspace", () => ({
  AuthWorkspace: ({ onSessionChange }: { onSessionChange?: (session: unknown) => void }) => (
    <div>
      <div>Access module mounted</div>
      <button
        type="button"
        onClick={() =>
          onSessionChange?.({
            authenticated: false,
            user: null,
            memberships: [],
            current_school: null,
            current_role: null,
          })
        }
      >
        Report signed out
      </button>
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
      vi.fn((_input, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          jsonResponse({
            authenticated: false,
            user: null,
            memberships: [],
            current_school: null,
            current_role: null,
          }),
        );
      }),
    );
  });

  it("links the landing page to the dedicated login route", () => {
    render(<AppWorkspace />);

    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Sign up" })[0]).toHaveAttribute("href", "/signup");
  });

  it("moves from direct login to a tabbed dashboard", async () => {
    const user = userEvent.setup();

    render(<AppWorkspace initialStage="login" />);

    expect(screen.getByText("Login portal mounted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Report signed out" }));
    expect(screen.getByText("Login portal mounted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete login" }));

    expect(await screen.findByText("Operations Overview")).toBeInTheDocument();
    expect(screen.queryByText("Access module mounted")).not.toBeInTheDocument();
    expect(screen.queryByText("Academics module mounted")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance module mounted")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Show Academics" }));

    expect(screen.getByText("Academics module mounted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Navigate to Attendance" }));

    expect(screen.queryByText("Academics module mounted")).not.toBeInTheDocument();
    expect(screen.getByText("Attendance module mounted")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Logout" })[0]);

    expect(
      screen.getByText("Run attendance, academics, and school operations beautifully."),
    ).toBeInTheDocument();
  });

  it("renders the dedicated signup experience", () => {
    render(<AppWorkspace initialStage="signup" />);

    expect(screen.getByText("Signup portal mounted")).toBeInTheDocument();
  });
});
