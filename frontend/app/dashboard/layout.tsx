import type { ReactNode } from "react";
import { DashboardShell } from "../ui/dashboard-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <main className="app-frame">
      <DashboardShell>{children}</DashboardShell>
    </main>
  );
}
