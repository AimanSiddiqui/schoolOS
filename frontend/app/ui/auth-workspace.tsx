"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { HealthCheck } from "./health-check";

type SchoolSummary = {
  id: string;
  name: string;
  timezone: string;
  language: string;
};

type MembershipSummary = {
  school: SchoolSummary;
  role: string;
};

type SessionPayload = {
  authenticated: boolean;
  user: {
    id: string;
    email: string;
    display_name: string;
  } | null;
  memberships: MembershipSummary[];
  current_school: SchoolSummary | null;
  current_role: string | null;
};

const emptySession: SessionPayload = {
  authenticated: false,
  user: null,
  memberships: [],
  current_school: null,
  current_role: null,
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
      }
    } catch {
      // The response body is optional for errors.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function AuthWorkspace() {
  const [session, setSession] = useState<SessionPayload>(emptySession);
  const [mode, setMode] = useState<"onboard" | "login">("onboard");
  const [message, setMessage] = useState("Checking session...");
  const [busy, setBusy] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const payload = await apiRequest<SessionPayload>("/auth/session");
      setSession(payload);
      setMessage(payload.authenticated ? "Session loaded." : "No active session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load session.");
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  async function handleOnboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Creating school...");
    try {
      const payload = await apiRequest<SessionPayload>("/auth/onboard", {
        method: "POST",
        body: JSON.stringify({
          school_name: form.get("school_name"),
          timezone: form.get("timezone"),
          language: form.get("language"),
          admin_name: form.get("admin_name"),
          admin_email: form.get("admin_email"),
          admin_password: form.get("admin_password"),
        }),
      });
      setSession(payload);
      setMessage("School created and admin signed in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create school.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Signing in...");
    try {
      const payload = await apiRequest<SessionPayload>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      setSession(payload);
      setMessage("Signed in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function selectSchool(schoolId: string) {
    setBusy(true);
    setMessage("Selecting school...");
    try {
      const payload = await apiRequest<SessionPayload>("/auth/select-school", {
        method: "POST",
        body: JSON.stringify({ school_id: schoolId }),
      });
      setSession(payload);
      setMessage("School context selected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to select school.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setMessage("Signing out...");
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
      setSession(emptySession);
      setMessage("Signed out.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="status-grid auth-grid">
      <HealthCheck />

      <section className="panel auth-panel" aria-labelledby="auth-heading">
        <div className="panel-heading">
          <h2 id="auth-heading">Access</h2>
          <fieldset className="segmented-control">
            <legend className="sr-only">Access mode</legend>
            <button
              type="button"
              className={mode === "onboard" ? "active" : ""}
              onClick={() => setMode("onboard")}
            >
              Onboard
            </button>
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              Login
            </button>
          </fieldset>
        </div>

        {mode === "onboard" ? (
          <form className="form-grid" onSubmit={handleOnboard}>
            <label>
              School name
              <input name="school_name" defaultValue="Local Demo School" required minLength={2} />
            </label>
            <label>
              Timezone
              <input name="timezone" defaultValue="Europe/Berlin" required />
            </label>
            <label>
              Language
              <input name="language" defaultValue="en" required />
            </label>
            <label>
              Admin name
              <input name="admin_name" defaultValue="Amina Admin" required minLength={2} />
            </label>
            <label>
              Admin email
              <input name="admin_email" type="email" defaultValue="admin@schoolos.local" required />
            </label>
            <label>
              Admin password
              <input
                name="admin_password"
                type="password"
                defaultValue="schoolos-admin-demo"
                required
                minLength={10}
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              Create first school
            </button>
          </form>
        ) : (
          <form className="form-grid" onSubmit={handleLogin}>
            <label>
              Email
              <input name="email" type="email" defaultValue="admin@schoolos.local" required />
            </label>
            <label>
              Password
              <input name="password" type="password" defaultValue="schoolos-admin-demo" required />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              Sign in
            </button>
          </form>
        )}
      </section>

      <section className="panel session-panel" aria-labelledby="session-heading">
        <div className="panel-heading">
          <h2 id="session-heading">Session</h2>
          <button className="icon-button" type="button" onClick={refreshSession} disabled={busy}>
            Refresh
          </button>
        </div>

        <p className={session.authenticated ? "health-label" : "muted"}>
          {session.authenticated ? session.user?.display_name : "Signed out"}
        </p>
        {session.user ? <p className="muted">{session.user.email}</p> : null}

        <div className="context-block">
          <p className="small-label">Selected school</p>
          <p className="context-value">
            {session.current_school
              ? `${session.current_school.name} (${session.current_role})`
              : "None selected"}
          </p>
        </div>

        {session.memberships.length > 0 ? (
          <div className="membership-list">
            {session.memberships.map((membership) => (
              <button
                key={membership.school.id}
                type="button"
                onClick={() => selectSchool(membership.school.id)}
                disabled={busy || membership.school.id === session.current_school?.id}
              >
                <span>{membership.school.name}</span>
                <span>{membership.role}</span>
              </button>
            ))}
          </div>
        ) : null}

        {session.authenticated ? (
          <button className="secondary-button" type="button" onClick={logout} disabled={busy}>
            Sign out
          </button>
        ) : null}
      </section>

      <section className="panel wide" aria-live="polite" aria-labelledby="status-heading">
        <h2 id="status-heading">Status</h2>
        <p className="muted">{message}</p>
      </section>
    </div>
  );
}
