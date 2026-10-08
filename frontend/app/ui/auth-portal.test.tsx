import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPortal } from "./auth-portal";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const signedOutSession = {
  authenticated: false,
  user: null,
  memberships: [],
  current_school: null,
  current_role: null,
};

const signedInSession = {
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
};

describe("AuthPortal", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits the polished login form", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(signedOutSession))
      .mockResolvedValueOnce(jsonResponse(signedInSession));
    vi.stubGlobal("fetch", fetchMock);
    const onSessionChange = vi.fn();
    const user = userEvent.setup();

    render(<AuthPortal mode="login" onSessionChange={onSessionChange} />);

    await user.type(screen.getByLabelText("Email"), "admin@schoolos.local");
    await user.type(screen.getByLabelText("Password"), "schoolos-admin-demo");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(onSessionChange).toHaveBeenCalledWith(signedInSession);
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/backend/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "admin@schoolos.local",
          password: "schoolos-admin-demo",
        }),
      }),
    );
  });

  it("keeps signup separate and points existing schools to login", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(signedOutSession))
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: "Onboarding is only available before the first school exists" },
          400,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AuthPortal mode="signup" />);

    expect(screen.getByRole("heading", { name: "Sign up" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("School name"), "Northview School");
    await user.type(screen.getByLabelText("Timezone"), "Europe/Berlin");
    await user.type(screen.getByLabelText("Language"), "en");
    await user.type(screen.getByLabelText("Administrator name"), "Amina Admin");
    await user.type(screen.getByLabelText("Work email"), "admin@schoolos.local");
    await user.type(screen.getByLabelText("Password"), "schoolos-admin-demo");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(
      await screen.findByText(
        "A school workspace already exists. Sign in with the administrator account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });
});
