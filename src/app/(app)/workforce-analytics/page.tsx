import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { maskingFor } from "@/lib/permissions";
import { attendanceStats, dayBuckets } from "@/lib/analytics/metrics";
import { fmtDuration, fmtIQDCompact, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TrendLines, ScatterPlot } from "@/components/ui/charts";
import { HBarList, HeatGrid } from "@/components/ui/viz";

export const metadata: Metadata = { title: "Workforce Analytics" };

export default async function WorkforceAnalyticsPage() {
  const user = await requireUser("workforce-analytics");
  const scope = await getScope(user);
  const masking = maskingFor(user.role);

  const [stats, records, employees, branches] = await Promise.all([
    attendanceStats(scope.branchIds, scope),
    db.attendanceRecord.findMany({
      where: { branchId: { in: scope.branchIds }, date: { gte: scope.from, lt: scope.to } },
      select: {
        date: true, status: true, lateMinutes: true, overtimeMinutes: true, branchId: true,
        employee: { select: { departmentId: true, department: { select: { name: true } } } },
      },
    }),
    db.employee.findMany({
      where: { branchId: { in: scope.branchIds }, employmentStatus: "ACTIVE" },
      select: { id: true, baseSalary: true, branchId: true },
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  if (records.length === 0) {
    return (
      <>
        <PageHeader title="Workforce Analytics" subtitle="Attendance, lateness, overtime and workforce cost patterns." />
        <EmptyState
          icon={<ChartColumn size={18} strokeWidth={1.5} />}
          title="No attendance data in this period"
          description="Analytics build up as attendance is recorded day by day."
          action={<Link href="/attendance" className="text-[13px] font-medium text-link hover:underline">Open attendance</Link>}
        />
      </>
    );
  }

  // Attendance trend
  const buckets = dayBuckets(scope);
  const trend = buckets.map((b) => {
    const bucket = records.filter((r) => r.date >= b.start && r.date < b.end);
    const working = bucket.filter((r) => r.status !== "HOLIDAY").length;
    const present = bucket.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    return {
      label: b.label,
      rate: working > 0 ? Math.round((present / working) * 1000) / 10 : 0,
      overtimeH: Math.round(bucket.reduce((s, r) => s + r.overtimeMinutes, 0) / 6) / 10,
    };
  });

  // Lateness by department
  const lateByDept = new Map<string, number>();
  for (const r of records) {
    if (r.lateMinutes > 0) {
      const dep = r.employee.department?.name ?? "No department";
      lateByDept.set(dep, (lateByDept.get(dep) ?? 0) + r.lateMinutes);
    }
  }

  // Attendance rate by branch
  const rateByBranch = branches.map((b) => {
    const bucket = records.filter((r) => r.branchId === b.id && r.status !== "HOLIDAY");
    const present = bucket.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    return { label: b.name, value: bucket.length > 0 ? Math.round((present / bucket.length) * 1000) / 10 : 0 };
  });

  // Heat grid: weekday × branch attendance rate
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const heatCells = branches.map((b) =>
    weekdays.map((_, wi) => {
      const bucket = records.filter((r) => r.branchId === b.id && r.date.getDay() === wi && r.status !== "HOLIDAY");
      if (bucket.length === 0) return 0;
      const present = bucket.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
      return present / bucket.length;
    }),
  );

  // Payroll cost vs branch productivity (visits) scatter
  const visitCounts = await db.visit.groupBy({
    by: ["branchId"],
    where: { branchId: { in: scope.branchIds }, registeredAt: { gte: scope.from, lt: scope.to } },
    _count: { id: true },
  });
  const visitsByBranch = new Map(visitCounts.map((v) => [v.branchId, v._count.id]));
  const scatter = branches.map((b) => ({
    label: b.name,
    x: employees.filter((e) => e.branchId === b.id).reduce((s, e) => s + e.baseSalary, 0),
    y: visitsByBranch.get(b.id) ?? 0,
  }));

  const payrollBase = employees.reduce((s, e) => s + e.baseSalary, 0);

  return (
    <>
      <PageHeader title="Workforce Analytics" subtitle="Attendance, lateness, overtime and workforce cost patterns across the group." />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Attendance rate" value={stats.rate !== null ? fmtPercent(stats.rate) : "—"} />
        <KpiCard label="Total lateness" value={fmtDuration(stats.totalLateMinutes)} />
        <KpiCard label="Total overtime" value={fmtDuration(stats.totalOvertimeMinutes)} />
        <KpiCard
          label="Monthly base payroll"
          value={masking.employeeSalary ? "Restricted" : fmtIQDCompact(payrollBase)}
          definition="Sum of active employees' base salaries."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Attendance & overtime trend" subtitle="Attendance % and overtime hours per day" />
          <CardBody>
            <TrendLines
              data={trend}
              series={[
                { key: "rate", label: "Attendance %", color: "#171717" },
                { key: "overtimeH", label: "Overtime (h)", color: "#f5a623" },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Attendance by branch" subtitle="Share of scheduled records present" />
          <CardBody>
            <HBarList items={rateByBranch.map((r) => ({ ...r, sublabel: "%" }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lateness by department" subtitle="Total late minutes in period" />
          <CardBody>
            {lateByDept.size === 0 ? (
              <p className="py-8 text-center text-[13px] text-mute">No lateness recorded in this period.</p>
            ) : (
              <HBarList
                items={[...lateByDept.entries()].sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, value: v, sublabel: "min" }))}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Attendance heat map" subtitle="By branch and weekday" />
          <CardBody>
            <HeatGrid rows={branches.map((b) => b.name)} cols={weekdays} cells={heatCells} legend="Darker = higher attendance" />
          </CardBody>
        </Card>
        {!masking.employeeSalary && (
          <Card className="lg:col-span-2">
            <CardHeader title="Payroll cost vs productivity" subtitle="Base payroll against patient visits per branch" />
            <CardBody>
              <ScatterPlot data={scatter} xLabel="Base payroll (IQD)" yLabel="Visits" money />
            </CardBody>
          </Card>
        )}
      </div>

      <p className="mt-4 text-[12px] text-mute">
        Group attendance is employee-weighted: each scheduled working record counts once, so branches with more staff weigh more.
      </p>
    </>
  );
}
