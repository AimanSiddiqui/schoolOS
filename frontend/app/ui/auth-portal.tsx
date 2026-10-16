"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Brand } from "./brand";

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
  const [showPassword, setShowPassword] = useState(false);

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
      <div className="auth-showcase">
        <Image
          src="/campus.jpg"
          alt="Graduates celebrating a shared milestone"
          fill
          priority
          sizes="(max-width: 760px) 100vw, 50vw"
          className="auth-photo"
        />
        <div className="auth-photo-brand">
          <Brand />
        </div>
        <div className="auth-photo-copy">
          <p>{isSignup ? "A new beginning." : "Together, we go further."}</p>
          <h2>
            {isSignup
              ? "Give your school a place to grow."
              : "Great school days start with connection."}
          </h2>
          <span>People. Learning. Possibility.</span>
        </div>
      </div>

      <section className="auth-card" aria-labelledby="login-heading">
        <Link className="auth-back" href="/">
          <ArrowLeft size={16} />
          Back to home
        </Link>
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-card-heading">
          <p className="eyebrow">
            {isSignup ? "A fresh start for your school" : "Your school day starts here"}
          </p>
          <h1 id="login-heading">{isSignup ? "Create account" : "Welcome back."}</h1>
          <p>
            {isSignup
              ? "Set up your school and its first administrator account."
              : "Log in to your SchoolOS workspace."}
          </p>
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
              <input
                name="admin_name"
                autoComplete="name"
                placeholder="Your full name"
                required
                minLength={2}
              />
            </label>
            <label>
              Work email
              <input
                name="admin_email"
                type="email"
                autoComplete="email"
                placeholder="you@school.edu"
                required
              />
            </label>
            <label htmlFor="signup-password">Password</label>
            <div className="password-field">
              <input
                id="signup-password"
                name="admin_password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 10 characters"
                required
                minLength={10}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button className="primary-button wide-button" type="submit" disabled={busy}>
              Create workspace
              <ArrowRight size={17} />
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@school.edu"
                required
              />
            </label>
            <label htmlFor="login-password">Password</label>
            <div className="password-field">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
              <button
                className="icon-button"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button className="primary-button wide-button" type="submit" disabled={busy}>
              Log in
              <ArrowRight size={17} />
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

        {message ? (
          <p className="auth-message" role="status">
            {message}
          </p>
        ) : null}

        <p className="auth-switch">
          {isSignup ? "Already have a workspace?" : "Setting up SchoolOS for the first time?"}{" "}
          <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create one"}</Link>
        </p>
        <p className="auth-security">
          <ShieldCheck size={15} />
          Private access to your school workspace
        </p>
      </section>
    </section>
  );
}
