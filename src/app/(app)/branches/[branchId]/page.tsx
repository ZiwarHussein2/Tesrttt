import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped, maskingFor } from "@/lib/permissions";
import {
  attendanceStats, branchHealth, complianceStats, financeSummary,
  inventoryStats, revenueExpenseTrend, visitStats,
} from "@/lib/analytics/metrics";
import {
  ageRange, fmtDate, fmtDateTime, fmtDuration, fmtIQD, fmtIQDCompact,
  fmtNumber, fmtPercent, maskName,
} from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionDialog, ActionButton } from "@/components/ui/dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { FunnelSteps, HBarList, ScoreRing } from "@/components/ui/viz";
import { TrendLines } from "@/components/ui/charts";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import {
  BRANCH_STATUS_LABELS, DEPARTMENT_TYPES, DEPARTMENT_TYPE_LABELS,
  EXPENSE_CATEGORY_LABELS, MACHINE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS, VISIT_STATUS_LABELS,
} from "@/types/enums";
import { updateBranch } from "../actions";
import { BranchFields } from "../branch-fields";
import { createDepartment, createMachine, setMachineStatus } from "../../departments/actions";

export const metadata: Metadata = { title: "Branch" };

const TABS = [
  "overview", "finance", "workforce", "operations", "departments",
  "inventory", "patients", "activity", "compliance", "audit",
] as const;
type Tab = (typeof TABS)[number];

export default async function BranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser("branches");
  const { branchId } = await params;
  const sp = await searchParams;

  if (isBranchScoped(user.role) && user.branchId !== branchId) notFound();

  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) notFound();

  const scope = await getScope(user);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const range = { from: scope.from, to: scope.to };
  const writable = canWrite(user.role, "branches");

  const tabs = TABS.map((t) => ({
    key: t,
    label: t === "activity" ? "Management Activity" : t.charAt(0).toUpperCase() + t.slice(1),
    href: `/branches/${branchId}?tab=${t}`,
  }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Branches", href: "/branches" }, { label: branch.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {branch.name}
            <Badge tone={statusTone(branch.status)} dot>
              {BRANCH_STATUS_LABELS[branch.status as keyof typeof BRANCH_STATUS_LABELS] ?? branch.status}
            </Badge>
          </span>
        }
        subtitle={`${branch.city} · Code ${branch.code}${branch.address ? ` · ${branch.address}` : ""}`}
        actions={
          <>
            <Link
              href={`/merna-ai?prompt=${encodeURIComponent(`Summarize the current situation of ${branch.name}`)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] font-medium text-violet-deep transition-colors hover:border-violet hover:bg-ai-soft"
            >
              <Sparkles size={13} /> Ask Merna AI
            </Link>
            {writable && (
              <ActionDialog
                trigger={<><Pencil size={13} /> Edit branch</>}
                title="Edit branch"
                description="Changes are recorded in the audit log."
                action={updateBranch}
                submitLabel="Save changes"
                wide
              >
                <input type="hidden" name="branchId" value={branch.id} />
                <BranchFields defaults={branch} />
              </ActionDialog>
            )}
          </>
        }
      />

      <Tabs tabs={tabs} current={tab} />

      {tab === "overview" && <OverviewTab branchId={branchId} range={range} />}
      {tab === "finance" && <FinanceTab branchId={branchId} range={range} />}
      {tab === "workforce" && <WorkforceTab branchId={branchId} range={range} masked={maskingFor(user.role).employeeContact} />}
      {tab === "operations" && <OperationsTab branchId={branchId} range={range} />}
      {tab === "departments" && <DepartmentsTab branchId={branchId} writable={canWrite(user.role, "departments")} />}
      {tab === "inventory" && <InventoryTab branchId={branchId} range={range} />}
      {tab === "patients" && <PatientsTab branchId={branchId} range={range} />}
      {(tab === "activity" || tab === "audit") && <AuditTab branchId={branchId} riskOnly={tab === "activity"} />}
      {tab === "compliance" && <ComplianceTab branchId={branchId} />}
    </>
  );
}

type R = { from: Date; to: Date };

async function OverviewTab({ branchId, range }: { branchId: string; range: R }) {
  const ids = [branchId];
  const [fin, ops, att, health, trend] = await Promise.all([
    financeSummary(ids, range),
    visitStats(ids, range),
    attendanceStats(ids, range),
    branchHealth(branchId, range),
    revenueExpenseTrend(ids, range),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Revenue" value={fmtIQDCompact(fin.revenue)} definition="Sum of all income entries received in the selected period." />
        <KpiCard label="Expenses" value={fmtIQDCompact(fin.expenses)} definition="Approved expenses dated within the selected period." />
        <KpiCard label="Net result" value={fmtIQDCompact(fin.net)} tone={fin.net < 0 ? "critical" : undefined} definition="Revenue minus approved expenses." />
        <KpiCard label="Patient visits" value={fmtNumber(ops.total)} definition="Visits registered in the selected period." />
        <KpiCard label="Active employees" value={fmtNumber(att.activeEmployees)} definition="Employees with status Active in this branch." />
        <KpiCard label="Attendance" value={att.rate !== null ? fmtPercent(att.rate) : "—"} definition="(Present + late) ÷ scheduled working records in period." />
        <KpiCard label="Average wait" value={ops.avgWaitMinutes !== null ? fmtDuration(ops.avgWaitMinutes) : "—"} definition="Average time from registration to being called." />
        <KpiCard label="Report backlog" value={fmtNumber(ops.reportBacklog)} tone={ops.reportBacklog > 20 ? "warning" : undefined} definition="Scans completed that still need a written report." />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue vs expenses" subtitle="Selected period, bucketed by day" />
          <CardBody>
            {trend.some((t) => (t.revenue as number) > 0 || (t.expenses as number) > 0) ? (
              <TrendLines
                data={trend}
                money
                series={[
                  { key: "revenue", label: "Revenue", color: "var(--chart-ink)" },
                  { key: "expenses", label: "Expenses", color: "var(--chart-gray)" },
                  { key: "net", label: "Net", color: "var(--color-link)" },
                ]}
              />
            ) : (
              <p className="py-10 text-center text-[13px] text-mute">No financial activity recorded in this period yet.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Branch health"
            subtitle="Weighted score — formula shown per component"
          />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-4">
              {health.total !== null ? <ScoreRing score={health.total} size={72} label="/ 100" /> : <p className="text-mute">Insufficient data</p>}
              <p className="text-[12px] leading-relaxed text-body">
                Weighted: Finance 25%, Operations 25%, Workforce 15%, Inventory 15%, Compliance 10%, Security 10%.
                Components without data are excluded and weights are redistributed.
              </p>
            </div>
            <ul className="space-y-2">
              {health.components.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-2 border-t border-hairline pt-2 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{c.label} <span className="text-[11px] font-normal text-mute">({c.weight}%)</span></p>
                    <p className="truncate text-[11px] text-mute" title={c.detail}>{c.detail}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    {c.score !== null ? Math.round(c.score) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

async function FinanceTab({ branchId, range }: { branchId: string; range: R }) {
  const ids = [branchId];
  const [fin, recent] = await Promise.all([
    financeSummary(ids, range),
    db.expense.findMany({
      where: { branchId, expenseDate: { gte: range.from, lt: range.to } },
      orderBy: { expenseDate: "desc" },
      take: 8,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Revenue" value={fmtIQDCompact(fin.revenue)} />
        <KpiCard label="Approved expenses" value={fmtIQDCompact(fin.expenses)} />
        <KpiCard label="Pending review" value={fmtIQDCompact(fin.pendingExpenses)} tone={fin.pendingExpenses > 0 ? "warning" : undefined} definition="Submitted or under-review expenses not yet approved." />
        <KpiCard label="Operating margin" value={fin.margin !== null ? fmtPercent(fin.margin * 100) : "—"} definition="Net result ÷ revenue." />
        <KpiCard label="Payroll expense" value={fmtIQDCompact(fin.payrollExpense)} definition="Approved expenses in Salaries and Overtime categories." />
        <KpiCard label="Reimbursements" value={fmtIQDCompact(fin.reimbursements)} />
        <KpiCard label="Discounts given" value={fmtIQDCompact(fin.discountValue)} definition="Total discount amounts on non-cancelled visits in period." />
        <KpiCard label="Waste cost" value={fmtIQDCompact(fin.wasteCost)} tone={fin.wasteCost > 0 ? "warning" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Expense composition" subtitle="Approved expenses by category" />
          <CardBody>
            {fin.expensesByCategory.length ? (
              <HBarList
                money
                items={fin.expensesByCategory.slice(0, 10).map((c) => ({
                  label: EXPENSE_CATEGORY_LABELS[c.category as keyof typeof EXPENSE_CATEGORY_LABELS] ?? c.category,
                  value: c.amount,
                }))}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-mute">No approved expenses in this period.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Income by method" subtitle="Cash, card and transfer collection" />
          <CardBody>
            {fin.incomeByMethod.length ? (
              <HBarList
                money
                items={fin.incomeByMethod.map((m) => ({
                  label: PAYMENT_METHOD_LABELS[m.method as keyof typeof PAYMENT_METHOD_LABELS] ?? m.method,
                  value: m.amount,
                }))}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-mute">No income entries in this period.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent expenses"
          actions={<Link href="/finance/expenses" className="text-[12px] font-medium text-link hover:underline">View all</Link>}
        />
        <TableShell className="rounded-t-none shadow-none">
          <THead>
            <Th>Date</Th><Th>Category</Th><Th>Description</Th><Th align="right">Amount</Th><Th>Status</Th>
          </THead>
          <tbody>
            {recent.length === 0 && <TableEmpty colSpan={5}>No expenses recorded in this period.</TableEmpty>}
            {recent.map((e) => (
              <Tr key={e.id}>
                <Td>{fmtDate(e.expenseDate)}</Td>
                <Td>{EXPENSE_CATEGORY_LABELS[e.category as keyof typeof EXPENSE_CATEGORY_LABELS] ?? e.category}</Td>
                <Td className="max-w-56 truncate">{e.description}</Td>
                <Td align="right">{fmtIQD(e.amount)}</Td>
                <Td><Badge tone={statusTone(e.status)}>{e.status.replace(/_/g, " ").toLowerCase()}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}

async function WorkforceTab({ branchId, range, masked }: { branchId: string; range: R; masked: boolean }) {
  const ids = [branchId];
  const [att, employees] = await Promise.all([
    attendanceStats(ids, range),
    db.employee.findMany({
      where: { branchId },
      include: { department: { select: { name: true } } },
      orderBy: { startDate: "desc" },
      take: 8,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Active employees" value={fmtNumber(att.activeEmployees)} />
        <KpiCard label="Attendance rate" value={att.rate !== null ? fmtPercent(att.rate) : "—"} />
        <KpiCard label="Late instances" value={fmtNumber(att.late)} />
        <KpiCard label="Absences" value={fmtNumber(att.absent)} tone={att.absent > 0 ? "warning" : undefined} />
        <KpiCard label="Overtime" value={fmtDuration(att.totalOvertimeMinutes)} />
        <KpiCard label="Late minutes" value={fmtDuration(att.totalLateMinutes)} />
        <KpiCard label="Exceptions" value={fmtNumber(att.exceptions)} tone={att.exceptions > 0 ? "warning" : undefined} definition="Device, network or location mismatches requiring review." />
        <KpiCard label="Missing checkout" value={fmtNumber(att.missingCheckout)} />
      </div>

      <Card>
        <CardHeader
          title="Employees"
          actions={<Link href="/employees" className="text-[12px] font-medium text-link hover:underline">View all</Link>}
        />
        <TableShell className="rounded-t-none shadow-none">
          <THead>
            <Th>Employee</Th><Th>Job title</Th><Th>Department</Th><Th>Status</Th><Th>Start date</Th>
          </THead>
          <tbody>
            {employees.length === 0 && <TableEmpty colSpan={5}>No employees registered in this branch yet.</TableEmpty>}
            {employees.map((e) => (
              <Tr key={e.id}>
                <Td>
                  <Link href={`/employees/${e.id}`} className="font-medium text-ink hover:underline">
                    {masked ? maskName(e.firstName, e.lastName) : `${e.firstName} ${e.lastName}`}
                  </Link>
                  <span className="block text-[11px] text-mute">{e.employeeCode}</span>
                </Td>
                <Td>{e.jobTitle}</Td>
                <Td>{e.department?.name ?? "—"}</Td>
                <Td><Badge tone={statusTone(e.employmentStatus)} dot>{e.employmentStatus.replace(/_/g, " ").toLowerCase()}</Badge></Td>
                <Td>{fmtDate(e.startDate)}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}

async function OperationsTab({ branchId, range }: { branchId: string; range: R }) {
  const ids = [branchId];
  const [ops, machines] = await Promise.all([
    visitStats(ids, range),
    db.machine.findMany({
      where: { department: { branchId } },
      include: { department: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Visits (period)" value={fmtNumber(ops.total)} />
        <KpiCard label="In queue now" value={fmtNumber(ops.inQueue)} definition="Visits currently paid, waiting, called or in progress." />
        <KpiCard label="Completion rate" value={ops.completionRate !== null ? fmtPercent(ops.completionRate * 100) : "—"} />
        <KpiCard label="Cancelled" value={fmtNumber(ops.cancelled)} />
        <KpiCard label="Avg wait" value={ops.avgWaitMinutes !== null ? fmtDuration(ops.avgWaitMinutes) : "—"} />
        <KpiCard label="Avg test duration" value={ops.avgDurationMinutes !== null ? fmtDuration(ops.avgDurationMinutes) : "—"} />
        <KpiCard label="Report backlog" value={fmtNumber(ops.reportBacklog)} tone={ops.reportBacklog > 20 ? "warning" : undefined} />
        <KpiCard label="Reports overdue" value={fmtNumber(ops.reportOverdue)} tone={ops.reportOverdue > 0 ? "critical" : undefined} definition="Backlog items older than 24 hours since scan completion." />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Patient flow" subtitle="Funnel across the visit lifecycle in period" />
          <CardBody>
            {ops.total > 0 ? (
              <FunnelSteps steps={ops.funnel} />
            ) : (
              <p className="py-8 text-center text-[13px] text-mute">No visits registered in this period.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Machines" subtitle="Current equipment status" />
          <CardBody>
            {machines.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-mute">No machines registered. Add them in the Departments tab.</p>
            ) : (
              <ul className="space-y-2.5">
                {machines.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                    <div>
                      <p className="text-[13px] font-medium text-ink">{m.name}</p>
                      <p className="text-[11.5px] text-mute">{m.department.name}{m.model ? ` · ${m.model}` : ""}</p>
                    </div>
                    <Badge tone={statusTone(m.status)} dot>
                      {MACHINE_STATUS_LABELS[m.status as keyof typeof MACHINE_STATUS_LABELS] ?? m.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Visits by department" subtitle="Registered in period" />
        <CardBody>
          {ops.byDepartmentType.length ? (
            <HBarList
              items={ops.byDepartmentType.map((d) => ({
                label: DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type,
                value: d.count,
              }))}
            />
          ) : (
            <p className="py-8 text-center text-[13px] text-mute">No visit data for this period.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function DepartmentsTab({ branchId, writable }: { branchId: string; writable: boolean }) {
  const departments = await db.department.findMany({
    where: { branchId },
    include: {
      machines: true,
      services: { where: { active: true }, select: { id: true } },
      _count: { select: { visits: { where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } } } } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      {writable && (
        <div className="flex justify-end">
          <ActionDialog
            trigger={<><Plus size={13} /> Add department</>}
            triggerVariant="primary"
            title="Add department"
            description="Departments are operationally separate: queues, inventory and performance are tracked per department."
            action={createDepartment}
            submitLabel="Create department"
            wide
          >
            <input type="hidden" name="branchId" value={branchId} />
            <DepartmentFields />
          </ActionDialog>
        </div>
      )}

      {departments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          description="Create the branch departments (Sonar, MRI, CT Scan, X-Ray, Mammography, DEXA) to start operating queues, services and inventory."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => (
            <Card key={d.id}>
              <CardHeader
                title={<Link href={`/departments/${d.id}`} className="hover:underline">{d.name}</Link>}
                subtitle={`${DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type} · ${d.operatingHoursStart}–${d.operatingHoursEnd}`}
                actions={<Badge tone={statusTone(d.status)} dot>{d.status.toLowerCase()}</Badge>}
              />
              <CardBody>
                <DescriptionList
                  columns={2}
                  items={[
                    { label: "In queue", value: fmtNumber(d._count.visits) },
                    { label: "Active services", value: fmtNumber(d.services.length) },
                    { label: "Daily capacity", value: fmtNumber(d.dailyCapacity) },
                    { label: "Wait target", value: `${d.targetWaitMinutes} min` },
                  ]}
                />
                <div className="mt-3 border-t border-hairline pt-3">
                  <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-mute">Machines</p>
                  {d.machines.length === 0 ? (
                    <p className="text-[12.5px] text-mute">None registered.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {d.machines.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2">
                          <span className="text-[12.5px] text-body">{m.name}</span>
                          <span className="flex items-center gap-1.5">
                            <Badge tone={statusTone(m.status)}>{MACHINE_STATUS_LABELS[m.status as keyof typeof MACHINE_STATUS_LABELS]}</Badge>
                            {writable && (
                              <ActionButton
                                label="Set status"
                                variant="ghost"
                                size="sm"
                                action={setMachineStatus}
                                confirmTitle={`Update status — ${m.name}`}
                                confirmDescription="Select the new machine status. Downtime affects queue capacity and revenue tracking."
                                requireReason
                                reasonLabel="Reason for status change"
                                hidden={{ machineId: m.id }}
                              />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {writable && (
                    <div className="mt-2.5">
                      <ActionDialog
                        trigger={<><Plus size={12} /> Add machine</>}
                        triggerSize="sm"
                        title={`Add machine — ${d.name}`}
                        action={createMachine}
                        submitLabel="Add machine"
                      >
                        <input type="hidden" name="departmentId" value={d.id} />
                        <div>
                          <Label htmlFor={`mn-${d.id}`} required>Machine name</Label>
                          <Input id={`mn-${d.id}`} name="name" placeholder="MRI Scanner 1" required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor={`mm-${d.id}`}>Model</Label>
                            <Input id={`mm-${d.id}`} name="model" placeholder="Model" />
                          </div>
                          <div>
                            <Label htmlFor={`ms-${d.id}`}>Serial number</Label>
                            <Input id={`ms-${d.id}`} name="serialNumber" placeholder="SN…" />
                          </div>
                        </div>
                      </ActionDialog>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentFields() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="df-type" required>Type</Label>
          <Select id="df-type" name="type" defaultValue="MRI">
            {DEPARTMENT_TYPES.map((t) => (
              <option key={t} value={t}>{DEPARTMENT_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="df-name" required>Name</Label>
          <Input id="df-name" name="name" placeholder="MRI" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="df-start">Opens</Label>
          <Input id="df-start" name="operatingHoursStart" defaultValue="08:00" placeholder="08:00" />
        </div>
        <div>
          <Label htmlFor="df-end">Closes</Label>
          <Input id="df-end" name="operatingHoursEnd" defaultValue="21:30" placeholder="21:30" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="df-wait">Wait target (min)</Label>
          <Input id="df-wait" name="targetWaitMinutes" type="number" defaultValue={30} min={1} />
        </div>
        <div>
          <Label htmlFor="df-cap">Daily capacity</Label>
          <Input id="df-cap" name="dailyCapacity" type="number" defaultValue={40} min={1} />
        </div>
      </div>
      <Hint>Capacity and wait target drive queue-pressure and bottleneck detection.</Hint>
    </>
  );
}

async function InventoryTab({ branchId, range }: { branchId: string; range: R }) {
  const ids = [branchId];
  const [inv, lowItems] = await Promise.all([
    inventoryStats(ids, range),
    db.inventoryItem.findMany({
      where: { branchId },
      include: { department: { select: { name: true } } },
      orderBy: { quantity: "asc" },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Stock value" value={fmtIQDCompact(inv.stockValue)} definition="Current quantity × unit cost across items." />
        <KpiCard label="Items tracked" value={fmtNumber(inv.itemCount)} />
        <KpiCard label="Low stock" value={fmtNumber(inv.lowStock)} tone={inv.lowStock > 0 ? "warning" : undefined} />
        <KpiCard label="Out of stock" value={fmtNumber(inv.outOfStock)} tone={inv.outOfStock > 0 ? "critical" : undefined} />
        <KpiCard label="Consumption (period)" value={fmtIQDCompact(inv.consumptionCost)} />
        <KpiCard label="Waste (period)" value={fmtIQDCompact(inv.wasteCost)} tone={inv.wasteCost > 0 ? "warning" : undefined} />
        <KpiCard label="Waste rate" value={inv.wasteRate !== null ? fmtPercent(inv.wasteRate) : "—"} definition="Waste cost ÷ (consumption + waste cost)." />
        <KpiCard label="Corrections" value={fmtNumber(inv.correctionsCount)} definition="Manual stock corrections in period — reviewed on the Waste & Variance page." />
      </div>

      <Card>
        <CardHeader
          title="Lowest stock items"
          actions={<Link href="/inventory" className="text-[12px] font-medium text-link hover:underline">Open inventory</Link>}
        />
        <TableShell className="rounded-t-none shadow-none">
          <THead>
            <Th>Item</Th><Th>Department</Th><Th align="right">Quantity</Th><Th align="right">Minimum</Th><Th>Status</Th>
          </THead>
          <tbody>
            {lowItems.length === 0 && <TableEmpty colSpan={5}>No inventory items registered for this branch.</TableEmpty>}
            {lowItems.map((i) => {
              const status = i.quantity <= 0 ? "OUT" : i.quantity <= i.minimumLevel ? "LOW" : "OK";
              return (
                <Tr key={i.id}>
                  <Td className="font-medium text-ink">{i.name}</Td>
                  <Td>{i.department?.name ?? "Branch-wide"}</Td>
                  <Td align="right">{fmtNumber(i.quantity)} {i.unit}</Td>
                  <Td align="right">{fmtNumber(i.minimumLevel)}</Td>
                  <Td>
                    <Badge tone={status === "OK" ? "good" : status === "LOW" ? "warning" : "critical"} dot>
                      {status === "OK" ? "In stock" : status === "LOW" ? "Low stock" : "Out of stock"}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}

async function PatientsTab({ branchId, range }: { branchId: string; range: R }) {
  const visits = await db.visit.findMany({
    where: { branchId, registeredAt: { gte: range.from, lt: range.to } },
    include: {
      patient: { select: { publicRef: true, firstName: true, lastName: true, birthYear: true } },
      department: { select: { name: true } },
    },
    orderBy: { registeredAt: "desc" },
    take: 12,
  });

  return (
    <Card>
      <CardHeader
        title="Recent visits"
        subtitle="Masked management view — no diagnosis, scans or contact details"
        actions={<Link href="/patients" className="text-[12px] font-medium text-link hover:underline">Patient intelligence</Link>}
      />
      <TableShell className="rounded-t-none shadow-none">
        <THead>
          <Th>Reference</Th><Th>Patient</Th><Th>Age range</Th><Th>Department</Th><Th>Status</Th><Th>Payment</Th><Th align="right">Registered</Th>
        </THead>
        <tbody>
          {visits.length === 0 && <TableEmpty colSpan={7}>No visits in this period.</TableEmpty>}
          {visits.map((v) => (
            <Tr key={v.id}>
              <Td mono>{v.patient.publicRef}</Td>
              <Td>{maskName(v.patient.firstName, v.patient.lastName)}</Td>
              <Td>{ageRange(v.patient.birthYear)}</Td>
              <Td>{v.department.name}</Td>
              <Td><Badge tone={statusTone(v.status)}>{VISIT_STATUS_LABELS[v.status as keyof typeof VISIT_STATUS_LABELS] ?? v.status}</Badge></Td>
              <Td><Badge tone={statusTone(v.paymentStatus)}>{v.paymentStatus.toLowerCase()}</Badge></Td>
              <Td align="right" className="text-mute">{fmtDateTime(v.registeredAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  );
}

async function AuditTab({ branchId, riskOnly }: { branchId: string; riskOnly: boolean }) {
  const events = await db.auditEvent.findMany({
    where: {
      branchId,
      ...(riskOnly ? { riskLevel: { in: ["MEDIUM", "HIGH"] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <Card>
      <CardHeader
        title={riskOnly ? "Management activity" : "Audit trail"}
        subtitle={riskOnly ? "Medium and high-risk actions in this branch" : "All recorded events for this branch"}
        actions={<Link href={riskOnly ? "/management-activities" : "/audit"} className="text-[12px] font-medium text-link hover:underline">Open full log</Link>}
      />
      <TableShell className="rounded-t-none shadow-none" dense>
        <THead>
          <Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Resource</Th><Th>Risk</Th><Th>Result</Th>
        </THead>
        <tbody>
          {events.length === 0 && <TableEmpty colSpan={6}>No recorded events yet.</TableEmpty>}
          {events.map((e) => (
            <Tr key={e.id}>
              <Td className="whitespace-nowrap text-mute">{fmtDateTime(e.createdAt)}</Td>
              <Td>{e.userName}</Td>
              <Td mono>{e.action}</Td>
              <Td className="max-w-52 truncate">{e.resourceLabel ?? e.resourceType}</Td>
              <Td><Badge tone={e.riskLevel === "HIGH" ? "critical" : e.riskLevel === "MEDIUM" ? "warning" : "neutral"}>{e.riskLevel.toLowerCase()}</Badge></Td>
              <Td><Badge tone={statusTone(e.result)}>{e.result.toLowerCase()}</Badge></Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  );
}

async function ComplianceTab({ branchId }: { branchId: string }) {
  const comp = await complianceStats([branchId]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Active employees" value={fmtNumber(comp.activeEmployees)} />
        <KpiCard label="Agreements accepted" value={comp.agreementRate !== null ? fmtPercent(comp.agreementRate) : "—"} definition="Active employees with an accepted employment agreement." />
        <KpiCard label="Policy acceptance" value={comp.policyAcceptanceRate !== null ? fmtPercent(comp.policyAcceptanceRate) : "—"} definition="Acceptances ÷ (active policies × active employees)." />
        <KpiCard label="Active policies" value={fmtNumber(comp.activePolicies)} />
        <KpiCard label="Pending expense reviews" value={fmtNumber(comp.pendingExpenseReviews)} tone={comp.pendingExpenseReviews > 0 ? "warning" : undefined} />
        <KpiCard label="Pending attendance reviews" value={fmtNumber(comp.pendingAttendanceReviews)} tone={comp.pendingAttendanceReviews > 0 ? "warning" : undefined} />
        <KpiCard label="Pending discounts" value={fmtNumber(comp.pendingDiscounts)} tone={comp.pendingDiscounts > 0 ? "warning" : undefined} />
        <KpiCard label="Total pending reviews" value={fmtNumber(comp.pendingTotal)} />
      </div>
      <p className="text-[12px] text-mute">
        Full evidence, agreement versions and acceptance records are in{" "}
        <Link href="/governance/legal" className="text-link hover:underline">Legal Accountability</Link>,{" "}
        <Link href="/agreements" className="text-link hover:underline">Agreements</Link> and{" "}
        <Link href="/policies" className="text-link hover:underline">Policies</Link>.
      </p>
    </div>
  );
}
