import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthWorkspace } from "./auth-workspace";

type FetchCall = Parameters<typeof fetch>;

const signedOutSession = {
  authenticated: false,
  user: null,
  memberships: [],
  current_school: null,
  current_role: null,
};

const adminSession = {
  authenticated: true,
  user: {
    id: "user-admin",
    email: "admin@schoolos.local",
    display_name: "Amina Admin",
  },
  memberships: [
    {
      school: {
        id: "school-demo",
        name: "Local Demo School",
        timezone: "Europe/Berlin",
        language: "en",
      },
      role: "ADMIN",
    },
  ],
  current_school: {
    id: "school-demo",
    name: "Local Demo School",
    timezone: "Europe/Berlin",
    language: "en",
  },
  current_role: "ADMIN",
};

const multiMembershipSession = {
  authenticated: true,
  user: {
    id: "user-teacher",
    email: "teacher@schoolos.local",
    display_name: "Tariq Teacher",
  },
  memberships: [
    {
      school: {
        id: "school-north",
        name: "North School",
        timezone: "Europe/Berlin",
        language: "en",
      },
      role: "ADMIN",
    },
    {
      school: {
        id: "school-south",
        name: "South School",
        timezone: "Europe/Berlin",
        language: "en",
      },
      role: "TEACHER",
    },
  ],
  current_school: null,
  current_role: null,
};

const selectedSouthSession = {
  ...multiMembershipSession,
  current_school: {
    id: "school-south",
    name: "South School",
    timezone: "Europe/Berlin",
    language: "en",
  },
  current_role: "TEACHER",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((...args: FetchCall) => {
    const [input, init] = args;
    return Promise.resolve(handler(String(input), init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AuthWorkspace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads signed-out state and backend health", async () => {
    mockFetch((url) => {
      if (url === "/api/backend/health") {
        return jsonResponse({ status: "ok", service: "schoolos-api", environment: "local" });
      }
      if (url === "/api/backend/auth/session") {
        return jsonResponse(signedOutSession);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<AuthWorkspace />);

    expect(await screen.findByText("schoolos-api")).toBeInTheDocument();
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(screen.getByText("No active session.")).toBeInTheDocument();
  });

  it("submits onboarding and shows the selected admin school", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/backend/health") {
        return jsonResponse({ status: "ok", service: "schoolos-api", environment: "local" });
      }
      if (url === "/api/backend/auth/session") {
        return jsonResponse(signedOutSession);
      }
      if (url === "/api/backend/auth/onboard" && init?.method === "POST") {
        return jsonResponse(adminSession, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(<AuthWorkspace />);

    await screen.findByText("No active session.");
    await user.click(screen.getByRole("button", { name: "Create first school" }));

    expect(await screen.findByText("School created and admin signed in.")).toBeInTheDocument();
    expect(screen.getByText("Amina Admin")).toBeInTheDocument();
    expect(screen.getByText("Local Demo School (ADMIN)")).toBeInTheDocument();

    const onboardCall = fetchMock.mock.calls.find(([url]) => url === "/api/backend/auth/onboard");
    expect(onboardCall).toBeDefined();
    expect(JSON.parse(String(onboardCall?.[1]?.body))).toMatchObject({
      school_name: "Local Demo School",
      admin_email: "admin@schoolos.local",
    });
  });

  it("logs in, selects a membership, and logs out", async () => {
    mockFetch((url, init) => {
      if (url === "/api/backend/health") {
        return jsonResponse({ status: "ok", service: "schoolos-api", environment: "local" });
      }
      if (url === "/api/backend/auth/session") {
        return jsonResponse(signedOutSession);
      }
      if (url === "/api/backend/auth/login" && init?.method === "POST") {
        return jsonResponse(multiMembershipSession);
      }
      if (url === "/api/backend/auth/select-school" && init?.method === "POST") {
        return jsonResponse(selectedSouthSession);
      }
      if (url === "/api/backend/auth/logout" && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(<AuthWorkspace />);

    await screen.findByText("No active session.");
    await user.click(screen.getByRole("button", { name: "Login" }));
    const loginForm = screen.getByLabelText("Email").closest("form");
    expect(loginForm).not.toBeNull();
    fireEvent.submit(loginForm as HTMLFormElement);

    expect(await screen.findByText("Signed in.")).toBeInTheDocument();
    expect(screen.getByText("Tariq Teacher")).toBeInTheDocument();
    expect(screen.getByText("None selected")).toBeInTheDocument();

    const sessionPanel = screen.getByRole("region", { name: "Session" });
    await user.click(within(sessionPanel).getByRole("button", { name: /South School/ }));

    expect(await screen.findByText("School context selected.")).toBeInTheDocument();
    expect(screen.getByText("South School (TEACHER)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByText("Signed out.")).toBeInTheDocument();
    });
    expect(screen.getByText("None selected")).toBeInTheDocument();
  });

  it("shows API error messages from failed requests", async () => {
    mockFetch((url, init) => {
      if (url === "/api/backend/health") {
        return jsonResponse({ status: "ok", service: "schoolos-api", environment: "local" });
      }
      if (url === "/api/backend/auth/session") {
        return jsonResponse(signedOutSession);
      }
      if (url === "/api/backend/auth/onboard" && init?.method === "POST") {
        return jsonResponse(
          { detail: "Onboarding is only available before the first school exists" },
          409,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(<AuthWorkspace />);

    await screen.findByText("No active session.");
    await user.click(screen.getByRole("button", { name: "Create first school" }));

    expect(
      await screen.findByText("Onboarding is only available before the first school exists"),
    ).toBeInTheDocument();
  });
});
