"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  School,
  Search,
  Settings2,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Brand } from "./brand";
import { dashboardLinks, type SessionPayload, sessionRequest } from "./session";

const navigationIcons = [LayoutDashboard, UsersRound, BookOpen, ClipboardCheck, Inbox, Settings2];

const DashboardSession = createContext<SessionPayload | null>(null);

export function useDashboardSession() {
  const session = useContext(DashboardSession);
  if (!session) throw new Error("Dashboard session is unavailable");
  return session;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const navigation = navigationRef.current;
    navigation?.querySelector<HTMLAnchorElement>(".side-nav a")?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key !== "Tab") return;
      const controls = Array.from(
        navigation?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [menuOpen]);

  const requireLogin = useCallback(() => {
    setSession(null);
    router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [router]);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      try {
        const payload = await sessionRequest<SessionPayload>("/auth/session");
        if (!active) return;
        if (!payload.authenticated || !payload.current_school) {
          requireLogin();
          return;
        }
        setError("");
        setSession(payload);
      } catch {
        if (active) setError("Unable to connect to your school. Please try again.");
      }
    }
    void attempt;
    void checkSession();
    window.addEventListener("focus", checkSession);
    return () => {
      active = false;
      window.removeEventListener("focus", checkSession);
    };
  }, [attempt, requireLogin]);

  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await sessionRequest<void>("/auth/logout", { method: "POST" });
      setSession(null);
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("Sign out failed. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  }

  if (error) {
    return (
      <section className="session-state" aria-label="School connection">
        <p role="alert">{error}</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
        <Link href="/login">Back to login</Link>
      </section>
    );
  }

  if (!session)
    return (
      <p className="session-state" role="status">
        Opening your school...
      </p>
    );

  const current = dashboardLinks.find((link) => link.href === pathname);
  const role = session.current_role ?? "";
  const permitted = !current || current.roles.includes(role);
  const initials = session.user?.display_name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  return (
    <DashboardSession.Provider value={session}>
      <section className="dashboard-shell" aria-label="SchoolOS dashboard">
        {menuOpen ? (
          <button
            type="button"
            className="nav-backdrop"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <aside
          ref={navigationRef}
          id="school-navigation"
          className={`dashboard-sidebar ${menuOpen ? "is-open" : ""}`}
          aria-label="Dashboard navigation"
        >
          <div className="sidebar-brand">
            <Brand href="/dashboard" />
            <button
              className="icon-button mobile-nav-toggle"
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <Link
            className="school-switch"
            href="/dashboard/account"
            onClick={() => setMenuOpen(false)}
          >
            <span className="school-symbol">
              <School size={19} />
            </span>
            <span>
              <strong>{session.current_school?.name}</strong>
              <small>School workspace</small>
            </span>
            <ChevronRight size={15} />
          </Link>
          <p className="nav-label">Workspace</p>
          <nav className="side-nav" aria-label="School sections">
            {dashboardLinks.map((link, index) => {
              const Icon = navigationIcons[index];
              return link.roles.includes(role) ? (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className={pathname === link.href ? "active" : ""}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                  <span>{link.label}</span>
                  {pathname === link.href ? <span className="active-nav-dot" /> : null}
                </Link>
              ) : null;
            })}
          </nav>
          <div className="sidebar-session">
            <Link
              className="user-profile"
              href="/dashboard/account"
              onClick={() => setMenuOpen(false)}
            >
              <span className="avatar">{initials}</span>
              <span>
                <strong>{session.user?.display_name}</strong>
                <small>
                  {role === "ADMIN" ? "Administrator" : role === "TEACHER" ? "Teacher" : "Guardian"}
                </small>
              </span>
            </Link>
            <button className="logout-button" type="button" disabled={loggingOut} onClick={logout}>
              <LogOut size={17} />
              {loggingOut ? "Signing out..." : "Log out"}
              <span className="sr-only"> of SchoolOS</span>
            </button>
          </div>
        </aside>
        <div className="dashboard-main" inert={menuOpen}>
          <header className="dashboard-topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-nav-toggle"
                type="button"
                aria-label="Open menu"
                aria-controls="school-navigation"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={21} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>{current?.label}</strong>
            </div>
            <div className="topbar-actions">
              {role === "ADMIN" ? (
                <form className="global-search" action="/dashboard/students" method="GET">
                  <Search size={17} />
                  <input aria-label="Find a student" name="q" placeholder="Find a student..." />
                </form>
              ) : null}
              <span className="topbar-date">
                <CalendarDays size={16} />
                {new Intl.DateTimeFormat("en-GB", {
                  day: "numeric",
                  month: "short",
                  timeZone: session.current_school?.timezone,
                }).format(new Date())}
              </span>
              <button
                className="icon-button"
                type="button"
                disabled={loggingOut}
                onClick={logout}
                aria-label="Log out"
                title="Log out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>
          {logoutError ? <p role="alert">{logoutError}</p> : null}
          <div className="dashboard-content">
            <div className="page-heading">
              <p className="eyebrow">{session.current_school?.name}</p>
              <h1>{current?.label === "Overview" ? "School overview" : current?.label}</h1>
            </div>
            {permitted ? (
              children
            ) : (
              <p role="alert" className="empty-state">
                This page is not available for your role.
              </p>
            )}
          </div>
        </div>
      </section>
    </DashboardSession.Provider>
  );
}
