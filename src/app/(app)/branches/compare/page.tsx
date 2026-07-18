import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { isBranchScoped } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  attendanceStats, branchHealth, financeSummary, inventoryStats, visitStats,
} from "@/lib/analytics/metrics";
import { fmtDuration, fmtIQDCompact, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TableShell, THead, Th, Tr, Td } from "@/components/ui/table";
import { CompareBars } from "@/components/ui/charts";
import { ScoreRing } from "@/components/ui/viz";
import { ExportCsvButton } from "@/components/ui/export-button";

export const metadata: Metadata = { title: "Branch comparison" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const user = await requireUser("branches");
  if (isBranchScoped(user.role)) {
    return (
      <EmptyState
        title="Comparison unavailable"
        description="Branch Admin accounts are scoped to a single branch and cannot compare across branches."
      />
    );
  }

  const scope = await getScope(user);
  const sp = await searchParams;
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).slice(0, 3);

  if (ids.length < 2) {
    return (
      <>
        <PageHeader
          breadcrumbs={[{ label: "Branches", href: "/branches" }, { label: "Compare" }]}
          title="Branch comparison"
          subtitle="Select two or three branches in the directory and choose “Compare selected”."
        />
        <EmptyState
          title="Select at least two branches"
          description="Use the checkboxes in the branch directory to pick the branches to compare."
          action={<Link href="/branches" className="text-[13px] font-medium text-link hover:underline">Back to branches</Link>}
        />
      </>
    );
  }

  const branches = await db.branch.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
  const range = { from: scope.from, to: scope.to };

  const data = await Promise.all(
    branches.map(async (b) => {
      const bid = [b.id];
      const [fin, ops, att, inv, health, alerts, mgmt] = await Promise.all([
        financeSummary(bid, range),
        visitStats(bid, range),
        attendanceStats(bid, range),
        inventoryStats(bid, range),
        branchHealth(b.id, range),
        db.alert.count({ where: { branchId: b.id, status: { not: "RESOLVED" } } }),
        db.auditEvent.count({ where: { branchId: b.id, riskLevel: { in: ["MEDIUM", "HIGH"] }, createdAt: { gte: range.from } } }),
      ]);
      return { branch: b, fin, ops, att, inv, health, alerts, mgmt };
    }),
  );

  const aiPrompt = `Explain the main differences between ${data.map((d) => d.branch.name).join(", ")} in the current period`;

  const metricRows: { label: string; values: (string | number)[]; better?: "high" | "low" }[] = [
    { label: "Health score", values: data.map((d) => (d.health.total !== null ? Math.round(d.health.total) : "—")), better: "high" },
    { label: "Revenue", values: data.map((d) => fmtIQDCompact(d.fin.revenue)), better: "high" },
    { label: "Expenses", values: data.map((d) => fmtIQDCompact(d.fin.expenses)), better: "low" },
    { label: "Net result", values: data.map((d) => fmtIQDCompact(d.fin.net)), better: "high" },
    { label: "Operating margin", values: data.map((d) => (d.fin.margin !== null ? fmtPercent(d.fin.margin * 100) : "—")), better: "high" },
    { label: "Patient visits", values: data.map((d) => fmtNumber(d.ops.total)), better: "high" },
    { label: "Completion rate", values: data.map((d) => (d.ops.completionRate !== null ? fmtPercent(d.ops.completionRate * 100) : "—")), better: "high" },
    { label: "Average wait", values: data.map((d) => (d.ops.avgWaitMinutes !== null ? fmtDuration(d.ops.avgWaitMinutes) : "—")), better: "low" },
    { label: "Report backlog", values: data.map((d) => fmtNumber(d.ops.reportBacklog)), better: "low" },
    { label: "Report turnaround", values: data.map((d) => (d.ops.avgReportTurnaroundHours !== null ? `${d.ops.avgReportTurnaroundHours.toFixed(1)}h` : "—")), better: "low" },
    { label: "Attendance rate", values: data.map((d) => (d.att.rate !== null ? fmtPercent(d.att.rate) : "—")), better: "high" },
    { label: "Overtime", values: data.map((d) => fmtDuration(d.att.totalOvertimeMinutes)), better: "low" },
    { label: "Employees", values: data.map((d) => fmtNumber(d.att.activeEmployees)) },
    { label: "Payroll expense", values: data.map((d) => fmtIQDCompact(d.fin.payrollExpense)), better: "low" },
    { label: "Discounts given", values: data.map((d) => fmtIQDCompact(d.fin.discountValue)), better: "low" },
    { label: "Inventory waste", values: data.map((d) => (d.inv.wasteRate !== null ? fmtPercent(d.inv.wasteRate) : "—")), better: "low" },
    { label: "Waste cost", values: data.map((d) => fmtIQDCompact(d.inv.wasteCost)), better: "low" },
    { label: "Open alerts", values: data.map((d) => fmtNumber(d.alerts)), better: "low" },
    { label: "Management activity (period)", values: data.map((d) => fmtNumber(d.mgmt)) },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Branches", href: "/branches" }, { label: "Compare" }]}
        title="Branch comparison"
        subtitle={data.map((d) => d.branch.name).join("  ·  ")}
        actions={
          <>
            <ExportCsvButton filename="merna-branch-comparison.csv" />
            <Link
              href={`/merna-ai?prompt=${encodeURIComponent(aiPrompt)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] font-medium text-violet-deep transition-colors hover:border-violet hover:bg-ai-soft"
            >
              <Sparkles size={13} /> Explain the main differences
            </Link>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {data.map((d) => (
          <Card key={d.branch.id}>
            <CardBody className="flex items-center gap-3">
              {d.health.total !== null ? <ScoreRing score={d.health.total} size={52} /> : <span className="text-mute">—</span>}
              <div className="min-w-0">
                <Link href={`/branches/${d.branch.id}`} className="block truncate text-[13px] font-semibold text-ink hover:underline">
                  {d.branch.name}
                </Link>
                <p className="text-[11.5px] text-mute">{d.branch.city}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div id="export-region" className="mb-4">
        <TableShell>
          <THead>
            <Th>Metric</Th>
            {data.map((d) => (
              <Th key={d.branch.id} align="right">{d.branch.name}</Th>
            ))}
          </THead>
          <tbody>
            {metricRows.map((row) => (
              <Tr key={row.label}>
                <Td className="font-medium text-ink">{row.label}</Td>
                {row.values.map((v, i) => (
                  <Td key={i} align="right">{v}</Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue, expenses and net" subtitle="Selected period" />
          <CardBody>
            <CompareBars
              money
              data={data.map((d) => ({
                label: d.branch.name.length > 14 ? d.branch.code : d.branch.name,
                revenue: d.fin.revenue,
                expenses: d.fin.expenses,
                net: d.fin.net,
              }))}
              series={[
                { key: "revenue", label: "Revenue", color: "var(--chart-ink)" },
                { key: "expenses", label: "Expenses", color: "var(--chart-gray)" },
                { key: "net", label: "Net", color: "var(--color-link)" },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Volume and workforce" subtitle="Visits and attendance-adjusted staffing" />
          <CardBody>
            <CompareBars
              data={data.map((d) => ({
                label: d.branch.name.length > 14 ? d.branch.code : d.branch.name,
                visits: d.ops.total,
                employees: d.att.activeEmployees,
                backlog: d.ops.reportBacklog,
              }))}
              series={[
                { key: "visits", label: "Visits", color: "var(--chart-ink)" },
                { key: "employees", label: "Employees", color: "var(--chart-gray)" },
                { key: "backlog", label: "Report backlog", color: "var(--color-warning)" },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
