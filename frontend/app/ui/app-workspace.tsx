"use client";

import { useState } from "react";
import { AttendanceWorkspace } from "./attendance-workspace";
import { AuthWorkspace } from "./auth-workspace";
import { SchoolSetupWorkspace } from "./school-setup-workspace";

type ModuleId = "access" | "academics" | "attendance";

const modules: { id: ModuleId; label: string; description: string }[] = [
  {
    id: "access",
    label: "Access",
    description: "Sign in, choose school context, and manage the active session.",
  },
  {
    id: "academics",
    label: "Academics",
    description: "Maintain school setup, directory records, profiles, and enrollments.",
  },
  {
    id: "attendance",
    label: "Attendance",
    description: "Record daily section attendance, finalize rosters, and apply corrections.",
  },
];

export function AppWorkspace() {
  const [activeModule, setActiveModule] = useState<ModuleId>("access");
  const currentModule = modules.find((module) => module.id === activeModule) ?? modules[0];

  return (
    <section className="app-workspace" aria-label="SchoolOS workspace">
      <nav className="module-nav" aria-label="Primary modules">
        {modules.map((module) => (
          <button
            key={module.id}
            type="button"
            className={activeModule === module.id ? "active" : ""}
            onClick={() => setActiveModule(module.id)}
          >
            <span>{module.label}</span>
            <small>{module.description}</small>
          </button>
        ))}
      </nav>

      <div className="module-heading">
        <p className="eyebrow">{currentModule.label}</p>
        <h2>{currentModule.description}</h2>
      </div>

      {activeModule === "access" ? <AuthWorkspace /> : null}
      {activeModule === "academics" ? <SchoolSetupWorkspace /> : null}
      {activeModule === "attendance" ? <AttendanceWorkspace /> : null}
    </section>
  );
}
