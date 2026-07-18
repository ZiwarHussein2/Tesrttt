import type { Metadata } from "next";
import Link from "next/link";
import { Grid2x2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDuration, fmtIQDCompact, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { ExportCsvButton } from "@/components/ui/export-button";
import { DEPARTMENT_TYPES, DEPARTMENT_TYPE_LABELS, MACHINE_STATUS_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; branch?: string }>;
}) {
  const user = await requireUser("departments");
  const scope = await getScope(user);
  const sp = await searchParams;

  const departments = await db.department.findMany({
    where: {
      branchId: { in: scope.branchIds },
      ...(sp.type ? { type: sp.type } : {}),
      ...(sp.branch ? { branchId: sp.branch } : {}),
      ...(sp.q ? { name: { contains: sp.q } } : {}),
    },
    include: {
      branch: { select: { id: true, name: true } },
      machines: { select: { status: true } },
      _count: {
        select: {
          visits: { where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } } },
          employees: true,
        },
      },
    },
    orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
  });

  // Period revenue per department
  const revenue = await db.incomeEntry.groupBy({
    by: ["departmentId"],
    where: {
      branchId: { in: scope.branchIds },
      receivedAt: { gte: scope.from, lt: scope.to },
      departmentId: { not: null },
    },
    _sum: { amount: true },
  });
  const revenueByDept = new Map(revenue.map((r) => [r.departmentId, r._sum.amount ?? 0]));

  // Avg wait per department (visits registered in range)
  const visits = await db.visit.findMany({
    where: {
      branchId: { in: scope.branchIds },
      registeredAt: { gte: scope.from, lt: scope.to },
      calledAt: { not: null },
    },
    select: { departmentId: true, registeredAt: true, calledAt: true },
  });
  const waits = new Map<string, number[]>();
  for (const v of visits) {
    const m = (v.calledAt!.getTime() - v.registeredAt.getTime()) / 60000;
    if (m >= 0 && m < 24 * 60) {
      if (!waits.has(v.departmentId)) waits.set(v.departmentId, []);
      waits.get(v.departmentId)!.push(m);
    }
  }

  const branches = await db.branch.findMany({
    where: { id: { in: scope.branchIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle="Operational units across the group — each department runs its own queue, services, machines and inventory."
        actions={<ExportCsvButton filename="merna-departments.csv" />}
      />

      {departments.length === 0 && !sp.q && !sp.type && !sp.branch ? (
        <EmptyState
          icon={<Grid2x2 size={18} strokeWidth={1.5} />}
          title="No departments yet"
          description="Departments are created inside a branch. Open a branch and add its departments from the Departments tab."
          action={<Link href="/branches" className="text-[13px] font-medium text-link hover:underline">Go to branches</Link>}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search department…" className="w-full sm:w-56" />
            <FilterSelect
              param="type"
              label="Type filter"
              allLabel="All types"
              options={DEPARTMENT_TYPES.map((t) => ({ value: t, label: DEPARTMENT_TYPE_LABELS[t] }))}
            />
            {branches.length > 1 && (
              <FilterSelect
                param="branch"
                label="Branch filter"
                allLabel="All branches"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            )}
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                <Th>Department</Th>
                <Th>Branch</Th>
                <Th>Status</Th>
                <Th align="right">In queue</Th>
                <Th align="right">Avg wait</Th>
                <Th align="right">Employees</Th>
                <Th align="right">Revenue (period)</Th>
                <Th>Machines</Th>
                <Th>Hours</Th>
              </THead>
              <tbody>
                {departments.length === 0 && <TableEmpty colSpan={9}>No departments match the current filters.</TableEmpty>}
                {departments.map((d) => {
                  const w = waits.get(d.id);
                  const avgWait = w?.length ? w.reduce((s, x) => s + x, 0) / w.length : null;
                  const overTarget = avgWait !== null && avgWait > d.targetWaitMinutes;
                  return (
                    <Tr key={d.id} highlight={overTarget}>
                      <Td>
                        <Link href={`/departments/${d.id}`} className="font-medium text-ink hover:underline">{d.name}</Link>
                        <span className="block text-[11px] text-mute">{DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type}</span>
                      </Td>
                      <Td>
                        <Link href={`/branches/${d.branch.id}`} className="hover:underline">{d.branch.name}</Link>
                      </Td>
                      <Td><Badge tone={statusTone(d.status)} dot>{d.status.toLowerCase()}</Badge></Td>
                      <Td align="right">{fmtNumber(d._count.visits)}</Td>
                      <Td align="right" className={overTarget ? "font-medium text-warning-deep" : undefined}>
                        {avgWait !== null ? fmtDuration(avgWait) : "—"}
                        <span className="block text-[10.5px] text-mute">target {d.targetWaitMinutes}m</span>
                      </Td>
                      <Td align="right">{fmtNumber(d._count.employees)}</Td>
                      <Td align="right">{fmtIQDCompact(revenueByDept.get(d.id) ?? 0)}</Td>
                      <Td>
                        {d.machines.length === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {d.machines.map((m, i) => (
                              <Badge key={i} tone={statusTone(m.status)}>
                                {MACHINE_STATUS_LABELS[m.status as keyof typeof MACHINE_STATUS_LABELS]}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </Td>
                      <Td className="text-mute">{d.operatingHoursStart}–{d.operatingHoursEnd}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        </>
      )}
    </>
  );
}
