import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { maskingFor } from "@/lib/permissions";
import { fmtDuration, fmtIQDCompact, fmtNumber, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { HBarList } from "@/components/ui/viz";

export const metadata: Metadata = { title: "Overtime" };

export default async function OvertimePage() {
  const user = await requireUser("overtime");
  const scope = await getScope(user);
  const masking = maskingFor(user.role);

  const records = await db.attendanceRecord.findMany({
    where: {
      branchId: { in: scope.branchIds },
      date: { gte: scope.from, lt: scope.to },
      overtimeMinutes: { gt: 0 },
    },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true, baseSalary: true,
          department: { select: { name: true } },
        },
      },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  });

  // Aggregate per employee
  const byEmployee = new Map<string, { name: string; id: string; code: string; dept: string; branch: string; minutes: number; days: number; estCost: number }>();
  for (const r of records) {
    const key = r.employee.id;
    const displayName = masking.employeeContact
      ? maskName(r.employee.firstName, r.employee.lastName)
      : `${r.employee.firstName} ${r.employee.lastName}`;
    const hourly = r.employee.baseSalary > 0 ? r.employee.baseSalary / (22 * 8) : 0; // est. monthly → hourly
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: displayName, id: key, code: r.employee.employeeCode,
        dept: r.employee.department?.name ?? "—", branch: r.branch.name,
        minutes: 0, days: 0, estCost: 0,
      });
    }
    const agg = byEmployee.get(key)!;
    agg.minutes += r.overtimeMinutes;
    agg.days += 1;
    agg.estCost += (r.overtimeMinutes / 60) * hourly;
  }
  const employees = [...byEmployee.values()].sort((a, b) => b.minutes - a.minutes);

  const byBranch = new Map<string, number>();
  for (const r of records) byBranch.set(r.branch.name, (byBranch.get(r.branch.name) ?? 0) + r.overtimeMinutes);

  const totalMinutes = records.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalCost = employees.reduce((s, e) => s + e.estCost, 0);

  return (
    <>
      <PageHeader
        title="Overtime"
        subtitle="Overtime accumulation across the group in the selected period, with estimated payroll impact."
        actions={<ExportCsvButton filename="merna-overtime.csv" />}
      />

      {records.length === 0 ? (
        <EmptyState
          icon={<Clock size={18} strokeWidth={1.5} />}
          title="No overtime recorded in this period"
          description="Overtime is derived automatically from attendance check-outs after the scheduled shift end."
          action={<Link href="/attendance" className="text-[13px] font-medium text-link hover:underline">Open attendance</Link>}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Total overtime" value={fmtDuration(totalMinutes)} />
            <KpiCard label="Employees with OT" value={fmtNumber(employees.length)} />
            <KpiCard label="OT instances" value={fmtNumber(records.length)} />
            <KpiCard label="Estimated cost" value={fmtIQDCompact(totalCost)} definition="Estimated from base salary ÷ (22 working days × 8h). Actual payroll amounts are set in payroll runs." />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Overtime by employee" subtitle="Selected period, most overtime first" />
              <TableShell className="rounded-t-none shadow-none">
                <THead>
                  <Th>Employee</Th><Th>Department</Th><Th>Branch</Th>
                  <Th align="right">Days</Th><Th align="right">Total OT</Th><Th align="right">Est. cost</Th>
                </THead>
                <tbody>
                  {employees.length === 0 && <TableEmpty colSpan={6}>No overtime data.</TableEmpty>}
                  {employees.map((e) => (
                    <Tr key={e.id}>
                      <Td>
                        <Link href={`/employees/${e.id}?tab=attendance`} className="font-medium text-ink hover:underline">{e.name}</Link>
                        <span className="block font-mono text-[10.5px] text-mute">{e.code}</span>
                      </Td>
                      <Td>{e.dept}</Td>
                      <Td>{e.branch}</Td>
                      <Td align="right">{e.days}</Td>
                      <Td align="right" className="font-medium text-ink">{fmtDuration(e.minutes)}</Td>
                      <Td align="right">{fmtIQDCompact(e.estCost)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </Card>

            <Card>
              <CardHeader title="Overtime by branch" />
              <CardBody>
                <HBarList
                  items={[...byBranch.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, minutes]) => ({ label, value: Math.round(minutes / 60), sublabel: "h" }))}
                />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
