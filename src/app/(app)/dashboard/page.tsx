import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

// Interim page — replaced by the full executive dashboard build step.
export default async function DashboardPage() {
  await requireUser("dashboard");
  return (
    <>
      <PageHeader title="Executive Dashboard" subtitle="Loading module…" />
      <EmptyState title="Dashboard is being assembled" description="This module is part of the current build." />
    </>
  );
}
