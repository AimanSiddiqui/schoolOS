import { AppWorkspace } from "../ui/app-workspace";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <AppWorkspace initialStage="login" />
    </main>
  );
}
