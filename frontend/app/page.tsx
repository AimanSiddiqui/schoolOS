import { AuthWorkspace } from "./ui/auth-workspace";
import { SchoolSetupWorkspace } from "./ui/school-setup-workspace";

export default function Home() {
  return (
    <main className="page-shell">
      <section className="workspace">
        <div className="overview">
          <p className="eyebrow">Identity and tenant isolation</p>
          <h1>SchoolOS</h1>
          <p className="summary">
            Create the first school, sign in, select a membership, and verify that every protected
            request is tied to an authorized school context.
          </p>
        </div>

        <AuthWorkspace />
        <SchoolSetupWorkspace />
      </section>
    </main>
  );
}
