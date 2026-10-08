import { AppWorkspace } from "./ui/app-workspace";

export default function Home() {
  return (
    <main className="page-shell">
      <section className="workspace">
        <div className="overview">
          <p className="eyebrow">School operations</p>
          <h1>SchoolOS</h1>
          <p className="summary">
            A local school-management workspace for access, academic records, student profiles, and
            daily attendance.
          </p>
        </div>

        <AppWorkspace />
      </section>
    </main>
  );
}
