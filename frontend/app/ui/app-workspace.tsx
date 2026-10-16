"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { AuthPortal } from "./auth-portal";
import { LandingPage } from "./landing-page";
import { loginDestination, type SessionPayload } from "./session";

type AppStage = "landing" | "login" | "signup";
type AppWorkspaceProps = {
  initialStage?: AppStage;
};

export function AppWorkspace({ initialStage = "landing" }: AppWorkspaceProps = {}) {
  const router = useRouter();
  const stage = initialStage;
  const handleSessionChange = useCallback(
    (payload: SessionPayload) => {
      if (payload.authenticated && payload.current_school) {
        router.replace(loginDestination(window.location.search));
      }
    },
    [router],
  );

  if (stage === "landing") return <LandingPage />;
  return <AuthPortal mode={stage} onSessionChange={handleSessionChange} />;
}
