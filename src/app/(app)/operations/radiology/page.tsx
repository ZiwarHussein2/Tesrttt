import type { Metadata } from "next";
import Link from "next/link";
import { Scan } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDuration, fmtIQDCompact, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { HeatGrid } from "@/components/ui/viz";
import { DEPARTMENT_TYPE_LABELS, MACHINE_STATUS_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Radiology Operations" };

export default async function RadiologyPage() {
  const user = await requireUser("radiology");
  const scope = await getScope(user);

  const departments = await db.department.findMany({
    where: { branchId: { in: scope.branchIds } },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      machines: true,
      pricingWindows: { orderBy: { startTime: "asc" } },
    },
    orderBy: [{ type: "asc" }, { branch: { name: "asc" } }],
  });

  if (departments.length === 0) {
    return (
      <>
        <PageHeader title="Radiology Operations" subtitle="Cross-branch performance by department type." />
        <EmptyState
          icon={<Scan size={18} strokeWidth={1.5} />}
          title="No departments yet"
          description="Radiology operations aggregate once branch departments exist."
          action={<Link href="/branches" className="text-[13px] font-medium text-link hover:underline">Go to branches</Link>}
        />
      </>
    );
  }

  const visits = await db.visit.findMany({
    where: { branchId: { in: scope.branchIds }, registeredAt: { gte: scope.from, lt: scope.to } },
    select: {
      departmentId: true, status: true, price: true, discountAmount: true, paidAmount: true,
      registeredAt: true, calledAt: true, scanStartedAt: true, scanCompletedAt: true,
      reportRequired: true, reportCompletedAt: true,
    },
  });
  const incomeByDept = await db.incomeEntry.groupBy({
    by: ["departmentId"],
    where: { branchId: { in: scope.branchIds }, receivedAt: { gte: scope.from, lt: scope.to }, departmentId: { not: null } },
    _sum: { amount: true },
  });
  const incomeMap = new Map(incomeByDept.map((i) => [i.departmentId, i._sum.amount ?? 0]));
  const queueCounts = await db.visit.groupBy({
    by: ["departmentId"],
    where: { branchId: { in: scope.branchIds }, status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } },
    _count: { id: true },
  });
  const queueMap = new Map(queueCounts.map((q) => [q.departmentId, q._count.id]));

  interface Row {
    dept: (typeof departments)[number];
    volume: number;
    queue: number;
    avgWait: number | null;
    avgDuration: number | null;
    completionRate: number | null;
    reportNeededRate: number | null;
    turnaroundH: number | null;
    revenue: number;
    utilization: number | null;
    bottleneck: boolean;
    machineDown: boolean;
  }

  const rows: Row[] = departments.map((d) => {
    const dv = visits.filter((v) => v.departmentId === d.id);
    const waits = dv.filter((v) => v.calledAt).map((v) => (v.calledAt!.getTime() - v.registeredAt.getTime()) / 60000).filter((m) => m >= 0 && m < 1440);
    const durs = dv.filter((v) => v.scanStartedAt && v.scanCompletedAt).map((v) => (v.scanCompletedAt!.getTime() - v.scanStartedAt!.getTime()) / 60000).filter((m) => m > 0);
    const completed = dv.filter((v) => v.status === "COMPLETED").length;
    const reportNeeded = dv.filter((v) => v.reportRequired).length;
    const turns = dv.filter((v) => v.scanCompletedAt && v.reportCompletedAt).map((v) => (v.reportCompletedAt!.getTime() - v.scanCompletedAt!.getTime()) / 3600000).filter((h) => h >= 0);
    const days = Math.max(1, Math.round((scope.to.getTime() - scope.from.getTime()) / 86400000));
    const capacity = d.dailyCapacity * days;
    const avgWait = waits.length ? waits.reduce((s, m) => s + m, 0) / waits.length : null;
    const machineDown = d.machines.some((m) => m.status === "OFFLINE" || m.status === "MAINTENANCE");
    return {
      dept: d,
      volume: dv.length,
      queue: queueMap.get(d.id) ?? 0,
      avgWait,
      avgDuration: durs.length ? durs.reduce((s, m) => s + m, 0) / durs.length : null,
      completionRate: dv.length ? completed / dv.length : null,
      reportNeededRate: dv.length ? reportNeeded / dv.length : null,
      turnaroundH: turns.length ? turns.reduce((s, h) => s + h, 0) / turns.length : null,
      revenue: incomeMap.get(d.id) ?? 0,
      utilization: capacity > 0 ? dv.length / capacity : null,
      bottleneck: (avgWait !== null && avgWait > d.targetWaitMinutes) || (queueMap.get(d.id) ?? 0) > d.dailyCapacity / 4 || machineDown,
      machineDown,
    };
  });

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const bottlenecks = rows.filter((r) => r.bottleneck).length;
  const downMachines = departments.flatMap((d) => d.machines).filter((m) => m.status === "OFFLINE" || m.status === "MAINTENANCE").length;

  // Queue-pressure heat grid: department type × branch
  const types = [...new Set(departments.map((d) => d.type))];
  const branches = [...new Set(departments.map((d) => d.branch.name))];
  const heat = types.map((t) =>
    branches.map((bName) => {
      const row = rows.find((r) => r.dept.type === t && r.dept.branch.name === bName);
      if (!row || row.utilization === null) return 0;
      return Math.min(1, row.utilization * 2);
    }),
  );

  return (
    <>
      <PageHeader
        title="Radiology Operations"
        subtitle="Cross-branch performance by department: volume, capacity, waits, reports, machines and revenue."
        actions={<ExportCsvButton filename="merna-radiology.csv" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total volume (period)" value={fmtNumber(totalVolume)} />
        <KpiCard label="Department revenue" value={fmtIQDCompact(totalRevenue)} />
        <KpiCard label="Bottleneck departments" value={fmtNumber(bottlenecks)} tone={bottlenecks > 0 ? "warning" : undefined} definition="Wait above target, queue above ¼ of daily capacity, or machine down." />
        <KpiCard label="Machines down" value={fmtNumber(downMachines)} tone={downMachines > 0 ? "critical" : undefined} />
      </div>

      <div id="export-region" className="mb-4">
        <TableShell dense>
          <THead>
            <Th>Department</Th><Th>Branch</Th><Th align="right">Volume</Th><Th align="right">Queue</Th>
            <Th align="right">Avg wait</Th><Th align="right">Duration</Th><Th align="right">Completion</Th>
            <Th align="right">Report rate</Th><Th align="right">Turnaround</Th><Th align="right">Utilization</Th>
            <Th align="right">Revenue</Th><Th>Machines</Th><Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <TableEmpty colSpan={13}>No departments.</TableEmpty>}
            {rows.map((r) => (
              <Tr key={r.dept.id} highlight={r.bottleneck}>
                <Td>
                  <Link href={`/departments/${r.dept.id}`} className="font-medium text-ink hover:underline">
                    {DEPARTMENT_TYPE_LABELS[r.dept.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? r.dept.name}
                  </Link>
                </Td>
                <Td>{r.dept.branch.name}</Td>
                <Td align="right">{fmtNumber(r.volume)}</Td>
                <Td align="right">{fmtNumber(r.queue)}</Td>
                <Td align="right" className={r.avgWait !== null && r.avgWait > r.dept.targetWaitMinutes ? "font-medium text-warning-deep" : undefined}>
                  {r.avgWait !== null ? fmtDuration(r.avgWait) : "—"}
                </Td>
                <Td align="right">{r.avgDuration !== null ? fmtDuration(r.avgDuration) : "—"}</Td>
                <Td align="right">{r.completionRate !== null ? fmtPercent(r.completionRate * 100, 0) : "—"}</Td>
                <Td align="right">{r.reportNeededRate !== null ? fmtPercent(r.reportNeededRate * 100, 0) : "—"}</Td>
                <Td align="right">{r.turnaroundH !== null ? `${r.turnaroundH.toFixed(1)}h` : "—"}</Td>
                <Td align="right">{r.utilization !== null ? fmtPercent(r.utilization * 100, 0) : "—"}</Td>
                <Td align="right">{fmtIQDCompact(r.revenue)}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {r.dept.machines.map((m) => (
                      <Badge key={m.id} tone={statusTone(m.status)}>{MACHINE_STATUS_LABELS[m.status as keyof typeof MACHINE_STATUS_LABELS]}</Badge>
                    ))}
                    {r.dept.machines.length === 0 && <span className="text-mute">—</span>}
                  </span>
                </Td>
                <Td>
                  {r.bottleneck
                    ? <Badge tone="warning" dot>Bottleneck</Badge>
                    : <Badge tone="good" dot>Normal</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Queue pressure map" subtitle="Utilization by department type and branch" />
          <CardBody>
            <HeatGrid
              rows={types.map((t) => DEPARTMENT_TYPE_LABELS[t as keyof typeof DEPARTMENT_TYPE_LABELS] ?? t)}
              cols={branches}
              cells={heat}
              legend="Darker = higher utilization vs capacity"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Time-based pricing windows" subtitle="Configured per department — e.g. MRI/CT 08:00–14:00 vs 14:00–21:30" />
          <CardBody>
            {departments.every((d) => d.pricingWindows.length === 0) ? (
              <p className="py-6 text-center text-[13px] text-mute">
                No pricing windows configured. Add them on each department page.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {departments.filter((d) => d.pricingWindows.length > 0).map((d) => (
                  <li key={d.id} className="border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                    <p className="text-[13px] font-medium text-ink">
                      <Link href={`/departments/${d.id}`} className="hover:underline">{d.name}</Link>
                      <span className="ml-1.5 text-[11px] font-normal text-mute">{d.branch.name}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {d.pricingWindows.map((w) => (
                        <Badge key={w.id} tone={w.priceMultiplier > 1 ? "warning" : "neutral"}>
                          {w.name}: {w.startTime}–{w.endTime} ×{w.priceMultiplier}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
