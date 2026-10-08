"use client";

import { useCallback, useEffect, useState } from "react";
import { AttendanceWorkspace } from "./attendance-workspace";
import { AuthWorkspace } from "./auth-workspace";
import { SchoolSetupWorkspace } from "./school-setup-workspace";

type SchoolSummary = {
  id: string;
  name: string;
  timezone: string;
  language: string;
};

type SessionPayload = {
  authenticated: boolean;
  user: {
    id: string;
    email: string;
    display_name: string;
  } | null;
  memberships: { school: SchoolSummary; role: string }[];
  current_school: SchoolSummary | null;
  current_role: string | null;
};

type AppStage = "landing" | "login" | "dashboard";
type DashboardView = "overview" | "academics" | "attendance" | "access";

const dashboardViews: { id: DashboardView; label: string; detail: string }[] = [
  { id: "overview", label: "Overview", detail: "Today" },
  { id: "academics", label: "Academics", detail: "Records" },
  { id: "attendance", label: "Attendance", detail: "Rosters" },
  { id: "access", label: "Access", detail: "Session" },
];

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function hasSchoolContext(session: SessionPayload | null): boolean {
  return Boolean(session?.authenticated && session.current_school);
}

export function AppWorkspace() {
  const [stage, setStage] = useState<AppStage>("landing");
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [session, setSession] = useState<SessionPayload | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<SessionPayload>("/auth/session")
      .then((payload) => {
        if (!active) {
          return;
        }
        setSession(payload);
        if (hasSchoolContext(payload)) {
          setStage("dashboard");
        }
      })
      .catch(() => {
        if (active) {
          setSession(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSessionChange = useCallback((payload: SessionPayload) => {
    setSession(payload);
    if (hasSchoolContext(payload)) {
      setStage("dashboard");
      setDashboardView("overview");
    } else if (!payload.authenticated) {
      setStage("landing");
      setDashboardView("overview");
    }
  }, []);

  async function logout() {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
    } catch {
      // A local logout should still clear the client shell if the session is already gone.
    }
    setSession(null);
    setDashboardView("overview");
    setStage("landing");
  }

  if (stage === "landing") {
    return (
      <section className="landing-page" aria-labelledby="landing-heading">
        <header className="landing-header">
          <div>
            <span className="brand-mark">SchoolOS</span>
            <p>Student operations, attendance, and follow-up in one local workspace.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setStage("login")}>
            Login
          </button>
        </header>

        <div className="landing-hero">
          <div className="landing-copy">
            <p className="eyebrow">School management system</p>
            <h1 id="landing-heading">Run the school day from one calm dashboard.</h1>
            <p className="summary">
              Manage academic setup, student profiles, attendance rosters, and follow-up workflows
              from a role-aware workspace built for administrators and teachers.
            </p>
            <div className="landing-actions">
              <button className="primary-button" type="button" onClick={() => setStage("login")}>
                Sign in
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setStage("dashboard");
                  setDashboardView("overview");
                }}
              >
                View dashboard shell
              </button>
            </div>
          </div>

          <div className="landing-visual" aria-hidden="true">
            <div className="visual-topbar">
              <span />
              <span />
              <span />
            </div>
            <div className="visual-grid">
              <div className="visual-panel attendance-preview">
                <small>Attendance</small>
                <strong>92%</strong>
                <span>Marked today</span>
              </div>
              <div className="visual-panel profile-preview">
                <small>Profiles</small>
                <strong>128</strong>
                <span>Active students</span>
              </div>
              <div className="visual-panel action-preview">
                <small>Follow-up</small>
                <strong>6</strong>
                <span>Open actions</span>
              </div>
            </div>
            <div className="visual-roster">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (stage === "login") {
    return (
      <section className="login-page" aria-labelledby="login-heading">
        <button className="secondary-button" type="button" onClick={() => setStage("landing")}>
          Back to landing
        </button>
        <div className="login-shell">
          <div className="login-copy">
            <p className="eyebrow">Secure access</p>
            <h1 id="login-heading">Sign in to SchoolOS</h1>
            <p className="summary">
              Choose your school context after authentication, then continue into the operational
              dashboard.
            </p>
          </div>
          <AuthWorkspace onSessionChange={handleSessionChange} />
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-shell" aria-label="SchoolOS dashboard">
      <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
        <div className="sidebar-brand">
          <span className="brand-mark">SchoolOS</span>
          <small>{session?.current_school?.name ?? "No school selected"}</small>
        </div>

        <nav className="side-nav">
          {dashboardViews.map((view) => (
            <button
              key={view.id}
              type="button"
              aria-label={`Navigate to ${view.label}`}
              aria-pressed={dashboardView === view.id}
              className={dashboardView === view.id ? "active" : ""}
              onClick={() => setDashboardView(view.id)}
            >
              <span>{view.label}</span>
              <small>{view.detail}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-session">
          <div>
            <span>{session?.user?.display_name ?? "Demo shell"}</span>
            <small>{session?.current_role ?? "Preview"}</small>
          </div>
          <button className="logout-button" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>{dashboardViews.find((view) => view.id === dashboardView)?.label}</h1>
          </div>
          <button className="secondary-button" type="button" onClick={logout}>
            Logout
          </button>
        </header>

        <div className="dashboard-tabs" role="tablist" aria-label="Dashboard tabs">
          {dashboardViews.slice(0, 3).map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-label={`Show ${view.label}`}
              aria-selected={dashboardView === view.id}
              className={dashboardView === view.id ? "active" : ""}
              onClick={() => setDashboardView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>

        {dashboardView === "overview" ? (
          <section className="dashboard-overview" aria-labelledby="dashboard-overview-heading">
            <div>
              <p className="eyebrow">Today</p>
              <h2 id="dashboard-overview-heading">Operations Overview</h2>
            </div>
            <div className="overview-grid">
              <section className="metric-panel">
                <p className="small-label">Attendance</p>
                <strong>Live</strong>
                <span>Open the Attendance tab to mark rosters</span>
                <button
                  className="metric-action"
                  type="button"
                  onClick={() => setDashboardView("attendance")}
                >
                  Open Attendance
                </button>
              </section>
              <section className="metric-panel">
                <p className="small-label">Students</p>
                <strong>Profiles</strong>
                <span>Directory and enrollment records</span>
                <button
                  className="metric-action"
                  type="button"
                  onClick={() => setDashboardView("academics")}
                >
                  Open Academics
                </button>
              </section>
              <section className="metric-panel">
                <p className="small-label">Setup</p>
                <strong>Ready</strong>
                <span>Years, grades, sections, subjects</span>
              </section>
              <section className="metric-panel">
                <p className="small-label">Next</p>
                <strong>Actions</strong>
                <span>Rule-based follow-up is the next milestone</span>
              </section>
            </div>
          </section>
        ) : null}

        {dashboardView === "academics" ? <SchoolSetupWorkspace /> : null}
        {dashboardView === "attendance" ? <AttendanceWorkspace /> : null}
        {dashboardView === "access" ? (
          <AuthWorkspace onSessionChange={handleSessionChange} />
        ) : null}
      </div>
    </section>
  );
}
