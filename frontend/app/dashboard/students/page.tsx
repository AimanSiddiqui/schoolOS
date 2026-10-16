import { SchoolSetupWorkspace } from "../../ui/school-setup-workspace";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  return <SchoolSetupWorkspace area="students" initialQuery={typeof q === "string" ? q : ""} />;
}
