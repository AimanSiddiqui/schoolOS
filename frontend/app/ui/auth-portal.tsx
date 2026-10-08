"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

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

type AuthPortalProps = {
  mode: "login" | "signup";
  onSessionChange?: (session: SessionPayload) => void;
};

const onboardingClosedMessage = "Onboarding is only available before the first school exists";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function hasSchoolContext(session: SessionPayload): boolean {
  return Boolean(session.authenticated && session.current_school);
}

export function AuthPortal({ mode, onSessionChange }: AuthPortalProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [memberships, setMemberships] = useState<MembershipSummary[]>([]);

  useEffect(() => {
    let active = true;
    apiRequest<SessionPayload>("/auth/session")
      .then((payload) => {
        if (!active) {
          return;
        }
        if (hasSchoolContext(payload)) {
          onSessionChange?.(payload);
        } else if (payload.authenticated && payload.memberships.length > 0) {
          setMemberships(payload.memberships);
          setMessage("Choose a school workspace to continue.");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onSessionChange]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Signing you in...");
    try {
      const payload = await apiRequest<SessionPayload>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (hasSchoolContext(payload)) {
        onSessionChange?.(payload);
        return;
      }
      setMemberships(payload.memberships);
      setMessage(
        payload.memberships.length > 0
          ? "Choose a school workspace to continue."
          : "Signed in. Ask an administrator to add you to a school.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Creating your school workspace...");
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
      onSessionChange?.(payload);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to create workspace.";
      setMessage(
        text === onboardingClosedMessage
          ? "A school workspace already exists. Sign in with the administrator account."
          : text,
      );
    } finally {
      setBusy(false);
    }
  }

  async function selectSchool(schoolId: string) {
    setBusy(true);
    setMessage("Opening workspace...");
    try {
      const payload = await apiRequest<SessionPayload>("/auth/select-school", {
        method: "POST",
        body: JSON.stringify({ school_id: schoolId }),
      });
      onSessionChange?.(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open workspace.");
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <section className={`auth-portal ${isSignup ? "signup-portal" : "login-portal"}`}>
      <div className="auth-hero-panel">
        <Link className="auth-brand" href="/">
          SchoolOS
        </Link>
        <p className="eyebrow">{isSignup ? "New school setup" : "Welcome back"}</p>
        <h1 id="login-heading">
          {isSignup ? "Create your school workspace." : "Sign in to your school dashboard."}
        </h1>
        <p>
          {isSignup
            ? "Set up the first administrator account and start organizing attendance, academics, and follow-up work."
            : "Open your workspace, pick the right school context, and continue the day from a focused dashboard."}
        </p>
        <section className="auth-highlights" aria-label="SchoolOS highlights">
          <span>Attendance ready</span>
          <span>Student records</span>
          <span>Role-aware access</span>
        </section>
      </div>

      <section className="auth-card" aria-labelledby="auth-card-heading">
        <div className="auth-card-heading">
          <p className="small-label">{isSignup ? "Start here" : "Secure access"}</p>
          <h2 id="auth-card-heading">{isSignup ? "Sign up" : "Log in"}</h2>
        </div>

        {isSignup ? (
          <form className="auth-form" onSubmit={handleSignup}>
            <label>
              School name
              <input name="school_name" placeholder="Northview School" required minLength={2} />
            </label>
            <div className="auth-form-row">
              <label>
                Timezone
                <input name="timezone" placeholder="Europe/Berlin" required />
              </label>
              <label>
                Language
                <input name="language" placeholder="en" required minLength={2} />
              </label>
            </div>
            <label>
              Administrator name
              <input name="admin_name" placeholder="Amina Admin" required minLength={2} />
            </label>
            <label>
              Work email
              <input name="admin_email" type="email" placeholder="admin@school.edu" required />
            </label>
            <label>
              Password
              <input
                name="admin_password"
                type="password"
                placeholder="At least 10 characters"
                required
                minLength={10}
              />
            </label>
            <button className="primary-button wide-button" type="submit" disabled={busy}>
              Create workspace
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              Email
              <input name="email" type="email" placeholder="admin@school.edu" required />
            </label>
            <label>
              Password
              <input name="password" type="password" placeholder="Enter your password" required />
            </label>
            <button className="primary-button wide-button" type="submit" disabled={busy}>
              Log in
            </button>
          </form>
        )}

        {memberships.length > 0 ? (
          <section className="school-picker" aria-label="Choose school">
            {memberships.map((membership) => (
              <button
                key={membership.school.id}
                type="button"
                onClick={() => selectSchool(membership.school.id)}
                disabled={busy}
              >
                <span>{membership.school.name}</span>
                <small>{membership.role}</small>
              </button>
            ))}
          </section>
        ) : null}

        {message ? <p className="auth-message">{message}</p> : null}

        <p className="auth-switch">
          {isSignup ? "Already have a workspace?" : "Setting up SchoolOS for the first time?"}{" "}
          <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create one"}</Link>
        </p>
      </section>
    </section>
  );
}
