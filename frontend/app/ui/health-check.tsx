"use client";

import { useEffect, useState } from "react";

type HealthState =
  | { status: "checking" }
  | { status: "ok"; service: string; environment: string }
  | { status: "error"; message: string };

export function HealthCheck() {
  const [health, setHealth] = useState<HealthState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/backend/health", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }
        const payload = (await response.json()) as { service: string; environment: string };
        if (!cancelled) {
          setHealth({ status: "ok", service: payload.service, environment: payload.environment });
        }
      } catch (error) {
        if (!cancelled) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to reach backend",
          });
        }
      }
    }

    loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel" aria-labelledby="health-heading">
      <h2 id="health-heading">API Health</h2>
      {health.status === "checking" ? (
        <p className="muted">Checking backend...</p>
      ) : health.status === "ok" ? (
        <div className="health-row">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <p className="health-label">{health.service}</p>
            <p className="muted">Environment: {health.environment}</p>
          </div>
        </div>
      ) : (
        <p className="error-text">{health.message}</p>
      )}
    </section>
  );
}
