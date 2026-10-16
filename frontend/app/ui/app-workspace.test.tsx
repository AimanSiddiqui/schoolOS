import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppWorkspace } from "./app-workspace";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

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
    navigation.replace.mockReset();
    window.history.replaceState(null, "", "/");
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

  it("keeps signed-out users on login and navigates after authentication", async () => {
    const user = userEvent.setup();

    render(<AppWorkspace initialStage="login" />);

    expect(screen.getByText("Login portal mounted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Report signed out" }));
    expect(screen.getByText("Login portal mounted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete login" }));

    expect(navigation.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("returns to the requested school page after login", async () => {
    window.history.replaceState(null, "", "/login?next=%2Fdashboard%2Fattendance");
    render(<AppWorkspace initialStage="login" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Complete login" }));
    expect(navigation.replace).toHaveBeenCalledWith("/dashboard/attendance");
  });

  it("ignores external return destinations", async () => {
    window.history.replaceState(null, "", "/login?next=https%3A%2F%2Fexample.com");
    render(<AppWorkspace initialStage="login" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Complete login" }));
    expect(navigation.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the dedicated signup experience", () => {
    render(<AppWorkspace initialStage="signup" />);

    expect(screen.getByText("Signup portal mounted")).toBeInTheDocument();
  });
});
