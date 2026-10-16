export type SchoolSummary = {
  id: string;
  name: string;
  timezone: string;
  language: string;
};

export type SessionPayload = {
  authenticated: boolean;
  user: { id: string; email: string; display_name: string } | null;
  memberships: { school: SchoolSummary; role: string }[];
  current_school: SchoolSummary | null;
  current_role: string | null;
};

export async function sessionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Request failed with ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const dashboardLinks = [
  { href: "/dashboard", label: "Overview", roles: ["ADMIN", "TEACHER", "GUARDIAN"] },
  { href: "/dashboard/students", label: "Students", roles: ["ADMIN"] },
  { href: "/dashboard/academics", label: "Academics", roles: ["ADMIN"] },
  { href: "/dashboard/attendance", label: "Attendance", roles: ["ADMIN", "TEACHER"] },
  { href: "/dashboard/actions", label: "Action Inbox", roles: ["ADMIN", "TEACHER"] },
  { href: "/dashboard/account", label: "Account", roles: ["ADMIN", "TEACHER", "GUARDIAN"] },
];

export function loginDestination(search: string): string {
  const requested = new URLSearchParams(search).get("next");
  return dashboardLinks.find((link) => link.href === requested)?.href ?? "/dashboard";
}
