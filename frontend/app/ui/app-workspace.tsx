"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AttendanceWorkspace } from "./attendance-workspace";
import { AuthPortal } from "./auth-portal";
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

type AppStage = "landing" | "login" | "signup" | "dashboard";
type DashboardView = "overview" | "academics" | "attendance" | "access";
type AppWorkspaceProps = {
  initialStage?: AppStage;
};

const dashboardViews: { id: DashboardView; label: string; detail: string; icon: string }[] = [
  { id: "overview", label: "Overview", detail: "Today", icon: "OV" },
  { id: "academics", label: "Academics", detail: "Records", icon: "AC" },
  { id: "attendance", label: "Attendance", detail: "Rosters", icon: "AT" },
  { id: "access", label: "Access", detail: "Session", icon: "ID" },
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

export function AppWorkspace({ initialStage = "landing" }: AppWorkspaceProps = {}) {
  const [stage, setStage] = useState<AppStage>(initialStage);
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
      setStage((currentStage) => (currentStage === "dashboard" ? "landing" : currentStage));
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
          <nav className="landing-nav" aria-label="Public navigation">
            <a href="#modules">Modules</a>
            <a href="#workflow">Workflow</a>
            <a href="#preview">Preview</a>
          </nav>
          <div className="landing-header-actions">
            <Link className="secondary-button" href="/login">
              Login
            </Link>
            <Link className="primary-button" href="/signup">
              Sign up
            </Link>
          </div>
        </header>

        <div className="landing-hero">
          <div className="landing-copy">
            <p className="eyebrow">School management system</p>
            <h1 id="landing-heading">
              Run attendance, academics, and school operations beautifully.
            </h1>
            <p className="summary">
              SchoolOS gives administrators and teachers a focused operating layer for student
              records, rosters, daily attendance, and follow-up workflows.
            </p>
            <section className="landing-proof" aria-label="SchoolOS operational highlights">
              <div>
                <strong>92%</strong>
                <span>Attendance marked</span>
              </div>
              <div>
                <strong>128</strong>
                <span>Active students</span>
              </div>
              <div>
                <strong>6</strong>
                <span>Follow-ups open</span>
              </div>
            </section>
            <div className="landing-actions">
              <Link className="primary-button" href="/login">
                Log in
              </Link>
              <Link className="secondary-button" href="/signup">
                Sign up
              </Link>
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

          <div id="preview" className="landing-visual" aria-hidden="true">
            <div className="visual-sidebar">
              <span className="visual-logo">S</span>
              <span />
              <span />
              <span />
            </div>
            <div className="visual-desktop">
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
        </div>

        <section id="modules" className="landing-section" aria-labelledby="modules-heading">
          <div>
            <p className="eyebrow">Modules</p>
            <h2 id="modules-heading">Built around the school day.</h2>
          </div>
          <div className="landing-module-grid">
            <article>
              <span>01</span>
              <h3>Student records</h3>
              <p>
                Profiles, memberships, sections, and academic setup stay in one organized workspace.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Attendance rosters</h3>
              <p>Teachers mark the day quickly while administrators keep a live operations view.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Follow-up work</h3>
              <p>
                Open actions are visible before they drift into hallway conversations and
                spreadsheets.
              </p>
            </article>
          </div>
        </section>

        <section
          id="workflow"
          className="landing-section workflow-section"
          aria-labelledby="workflow-heading"
        >
          <div>
            <p className="eyebrow">Workflow</p>
            <h2 id="workflow-heading">From first bell to final follow-up.</h2>
          </div>
          <ol className="workflow-steps">
            <li>Open the school dashboard and confirm today&apos;s context.</li>
            <li>Review academic sections and student membership changes.</li>
            <li>Mark attendance, resolve exceptions, and hand off follow-up work.</li>
          </ol>
        </section>
      </section>
    );
  }

  if (stage === "login" || stage === "signup") {
    return (
      <section className="login-page" aria-labelledby="login-heading">
        <Link className="secondary-button" href="/">
          Back to landing
        </Link>
        <AuthPortal
          mode={stage === "signup" ? "signup" : "login"}
          onSessionChange={handleSessionChange}
        />
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
              <span className="nav-icon">{view.icon}</span>
              <span className="nav-copy">
                <span>{view.label}</span>
                <small>{view.detail}</small>
              </span>
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
          <div className="topbar-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDashboardView("access")}
            >
              Account
            </button>
            <button className="logout-top-button" type="button" onClick={logout}>
              Logout
            </button>
          </div>
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

        <div className="dashboard-content" key={dashboardView}>
          {dashboardView === "overview" ? (
            <section className="dashboard-overview" aria-labelledby="dashboard-overview-heading">
              <div className="overview-hero-panel">
                <div>
                  <p className="eyebrow">Today</p>
                  <h2 id="dashboard-overview-heading">Operations Overview</h2>
                  <p>
                    Start with attendance, keep records clean, and move follow-up work into the next
                    milestone.
                  </p>
                </div>
                <section className="school-day-card" aria-label="School day status">
                  <span>School day</span>
                  <strong>Open</strong>
                  <small>{session?.current_school?.name ?? "Dashboard preview"}</small>
                </section>
              </div>

              <div className="overview-grid">
                <section className="metric-panel premium-card">
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
                <section className="metric-panel premium-card">
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
                <section className="metric-panel premium-card">
                  <p className="small-label">Setup</p>
                  <strong>Ready</strong>
                  <span>Years, grades, sections, subjects</span>
                </section>
                <section className="metric-panel premium-card">
                  <p className="small-label">Next</p>
                  <strong>Actions</strong>
                  <span>Rule-based follow-up is the next milestone</span>
                </section>
              </div>

              <div className="operations-grid">
                <section className="ops-panel">
                  <p className="small-label">Suggested Workflow</p>
                  <ol>
                    <li>Confirm the school context in Access.</li>
                    <li>Review active sections and enrollments in Academics.</li>
                    <li>Mark today&apos;s attendance and finalize each roster.</li>
                  </ol>
                </section>
                <section className="ops-panel accent-panel">
                  <p className="small-label">Today&apos;s Focus</p>
                  <strong>Attendance completion</strong>
                  <span>Finalize every active section before follow-up rules run.</span>
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
      </div>
    </section>
  );
}
