import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtDuration, fmtIQD, fmtIQDCompact, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ActionDialog, ActionButton } from "@/components/ui/dialog";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import {
  DEPARTMENT_TYPE_LABELS, MACHINE_STATUSES, MACHINE_STATUS_LABELS,
} from "@/types/enums";
import {
  addRecipeItem, createPricingWindow, createService, deletePricingWindow,
  removeRecipeItem, setMachineStatus, updateDepartment, updateServicePrice,
} from "../actions";

export const metadata: Metadata = { title: "Department" };

function nowWithin(start: string, end: string): boolean {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return cur >= sh * 60 + sm && cur < eh * 60 + em;
}

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ departmentId: string }>;
}) {
  const user = await requireUser("departments");
  const { departmentId } = await params;
  const scope = await getScope(user);

  const department = await db.department.findUnique({
    where: { id: departmentId },
    include: {
      branch: { select: { id: true, name: true } },
      machines: true,
      pricingWindows: { orderBy: { startTime: "asc" } },
      services: {
        orderBy: { name: "asc" },
        include: { recipeItems: { include: { inventoryItem: { select: { id: true, name: true, unit: true } } } } },
      },
    },
  });
  if (!department) notFound();
  if (isBranchScoped(user.role) && user.branchId !== department.branchId) notFound();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayVisits, waitingNow, currentVisit, completedToday, periodVisits, revenueAgg, expenseAgg, wasteMovements, reportPending, attendanceToday, inventoryItems] =
    await Promise.all([
      db.visit.count({ where: { departmentId, registeredAt: { gte: todayStart } } }),
      db.visit.count({ where: { departmentId, status: { in: ["PAID", "WAITING", "CALLED"] } } }),
      db.visit.findFirst({
        where: { departmentId, status: "IN_PROGRESS" },
        include: { patient: { select: { publicRef: true } } },
      }),
      db.visit.count({ where: { departmentId, status: "COMPLETED", completedAt: { gte: todayStart } } }),
      db.visit.findMany({
        where: { departmentId, registeredAt: { gte: scope.from, lt: scope.to } },
        select: { registeredAt: true, calledAt: true, scanStartedAt: true, scanCompletedAt: true },
      }),
      db.incomeEntry.aggregate({
        where: { departmentId, receivedAt: { gte: scope.from, lt: scope.to } },
        _sum: { amount: true },
      }),
      db.expense.aggregate({
        where: { departmentId, status: "APPROVED", expenseDate: { gte: scope.from, lt: scope.to } },
        _sum: { amount: true },
      }),
      db.inventoryMovement.findMany({
        where: { item: { departmentId }, type: "WASTED", occurredAt: { gte: scope.from, lt: scope.to } },
        include: { item: { select: { unitCost: true } } },
      }),
      db.visit.count({
        where: { departmentId, reportRequired: true, status: { in: ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING"] } },
      }),
      db.attendanceRecord.count({
        where: { employee: { departmentId }, date: { gte: todayStart }, status: { in: ["PRESENT", "LATE"] } },
      }),
      db.inventoryItem.findMany({
        where: { branchId: department.branchId },
        select: { id: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const waits = periodVisits
    .filter((v) => v.calledAt)
    .map((v) => (v.calledAt!.getTime() - v.registeredAt.getTime()) / 60000)
    .filter((m) => m >= 0 && m < 1440);
  const durations = periodVisits
    .filter((v) => v.scanStartedAt && v.scanCompletedAt)
    .map((v) => (v.scanCompletedAt!.getTime() - v.scanStartedAt!.getTime()) / 60000)
    .filter((m) => m > 0 && m < 720);
  const avgWait = waits.length ? waits.reduce((s, m) => s + m, 0) / waits.length : null;
  const avgDuration = durations.length ? durations.reduce((s, m) => s + m, 0) / durations.length : null;
  const wasteCost = wasteMovements.reduce((s, m) => s + Math.abs(m.quantity) * m.item.unitCost, 0);
  const activeWindow = department.pricingWindows.find((w) => nowWithin(w.startTime, w.endTime));

  const writable = canWrite(user.role, "departments");
  const open = nowWithin(department.operatingHoursStart, department.operatingHoursEnd);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Departments", href: "/departments" },
          { label: department.branch.name, href: `/branches/${department.branch.id}` },
          { label: department.name },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {department.name}
            <Badge tone={statusTone(department.status)} dot>{department.status.toLowerCase()}</Badge>
            <Badge tone={open ? "good" : "neutral"}>{open ? "Open now" : "Outside hours"}</Badge>
          </span>
        }
        subtitle={`${DEPARTMENT_TYPE_LABELS[department.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? department.type} · ${department.branch.name} · ${department.operatingHoursStart}–${department.operatingHoursEnd}${activeWindow ? ` · Current pricing window: ${activeWindow.name} ×${activeWindow.priceMultiplier}` : ""}`}
        actions={
          <>
            <Link
              href={`/queues?department=${department.id}`}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-on-primary hover:bg-black"
            >
              Open queue board
            </Link>
            {writable && (
              <ActionDialog
                trigger={<><Pencil size={13} /> Edit</>}
                title="Edit department"
                description="Changes are recorded in the audit log."
                action={updateDepartment}
                submitLabel="Save changes"
              >
                <input type="hidden" name="departmentId" value={department.id} />
                <div>
                  <Label htmlFor="ed-name" required>Name</Label>
                  <Input id="ed-name" name="name" defaultValue={department.name} required />
                </div>
                <div>
                  <Label htmlFor="ed-status">Status</Label>
                  <Select id="ed-status" name="status" defaultValue={department.status}>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="CLOSED">Closed</option>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="ed-start">Opens</Label>
                    <Input id="ed-start" name="operatingHoursStart" defaultValue={department.operatingHoursStart} />
                  </div>
                  <div>
                    <Label htmlFor="ed-end">Closes</Label>
                    <Input id="ed-end" name="operatingHoursEnd" defaultValue={department.operatingHoursEnd} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="ed-wait">Wait target (min)</Label>
                    <Input id="ed-wait" name="targetWaitMinutes" type="number" defaultValue={department.targetWaitMinutes} min={1} />
                  </div>
                  <div>
                    <Label htmlFor="ed-cap">Daily capacity</Label>
                    <Input id="ed-cap" name="dailyCapacity" type="number" defaultValue={department.dailyCapacity} min={1} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="ed-reason">Reason for change</Label>
                  <Input id="ed-reason" name="reason" placeholder="Recorded in the audit log" />
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Today's patients" value={fmtNumber(todayVisits)} />
        <KpiCard label="Waiting now" value={fmtNumber(waitingNow)} tone={waitingNow > department.dailyCapacity / 4 ? "warning" : undefined} />
        <KpiCard label="Current patient" value={currentVisit ? currentVisit.patient.publicRef : "—"} definition="Visit currently in progress." />
        <KpiCard label="Completed today" value={fmtNumber(completedToday)} />
        <KpiCard label="Avg wait (period)" value={avgWait !== null ? fmtDuration(avgWait) : "—"} definition={`Target: ${department.targetWaitMinutes} min.`} tone={avgWait !== null && avgWait > department.targetWaitMinutes ? "warning" : undefined} />
        <KpiCard label="Avg test duration" value={avgDuration !== null ? fmtDuration(avgDuration) : "—"} />
        <KpiCard label="Revenue (period)" value={fmtIQDCompact(revenueAgg._sum.amount ?? 0)} />
        <KpiCard label="Direct expense" value={fmtIQDCompact(expenseAgg._sum.amount ?? 0)} />
        <KpiCard label="Waste (period)" value={fmtIQDCompact(wasteCost)} tone={wasteCost > 0 ? "warning" : undefined} />
        <KpiCard label="Reports pending" value={fmtNumber(reportPending)} tone={reportPending > 0 ? "warning" : undefined} />
        <KpiCard label="Staff present today" value={fmtNumber(attendanceToday)} />
        <KpiCard label="Daily capacity" value={fmtNumber(department.dailyCapacity)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Services */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Services & price list"
            subtitle="Price changes require a reason and are audited"
            actions={
              writable ? (
                <ActionDialog
                  trigger={<><Plus size={12} /> Add service</>}
                  triggerSize="sm"
                  title={`Add service — ${department.name}`}
                  action={createService}
                  submitLabel="Create service"
                >
                  <input type="hidden" name="departmentId" value={department.id} />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="sv-name" required>Name</Label>
                      <Input id="sv-name" name="name" placeholder="MRI Brain" required />
                    </div>
                    <div>
                      <Label htmlFor="sv-code" required>Code</Label>
                      <Input id="sv-code" name="code" placeholder="MRI-BRN" required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="sv-price" required>Base price (IQD)</Label>
                      <Input id="sv-price" name="basePrice" type="number" min={0} step="1000" required />
                    </div>
                    <div>
                      <Label htmlFor="sv-dur">Duration (min)</Label>
                      <Input id="sv-dur" name="durationMinutes" type="number" defaultValue={20} min={1} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[13px] text-body">
                    <input type="checkbox" name="reportRequired" className="h-3.5 w-3.5 accent-[#171717]" />
                    Requires a written doctor report
                  </label>
                </ActionDialog>
              ) : undefined
            }
          />
          <TableShell className="rounded-t-none shadow-none">
            <THead>
              <Th>Service</Th><Th align="right">Price</Th><Th align="right">Duration</Th><Th>Report</Th><Th>Expected assets</Th>{writable && <Th align="right">Actions</Th>}
            </THead>
            <tbody>
              {department.services.length === 0 && (
                <TableEmpty colSpan={writable ? 6 : 5}>No services yet. Add the tests this department performs.</TableEmpty>
              )}
              {department.services.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="block font-mono text-[10.5px] text-mute">{s.code}{!s.active && " · inactive"}</span>
                  </Td>
                  <Td align="right">{fmtIQD(s.basePrice)}</Td>
                  <Td align="right">{s.durationMinutes} min</Td>
                  <Td>{s.reportRequired ? <Badge tone="ok">Required</Badge> : <Badge tone="neutral">No</Badge>}</Td>
                  <Td>
                    {s.recipeItems.length === 0 ? (
                      <span className="text-[12px] text-mute">None defined</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {s.recipeItems.map((r) => (
                          <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-canvas-soft-2 px-2 py-0.5 text-[11px] text-body">
                            {r.inventoryItem.name} ×{r.quantity}{r.optional ? " (opt)" : ""}
                            {writable && (
                              <ActionButton
                                label={<Trash2 size={10} />}
                                variant="ghost"
                                size="sm"
                                className="h-4 w-4 justify-center p-0"
                                action={removeRecipeItem}
                                hidden={{ recipeItemId: r.id }}
                              />
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </Td>
                  {writable && (
                    <Td align="right">
                      <span className="flex justify-end gap-1.5">
                        <ActionDialog
                          trigger="Price"
                          triggerSize="sm"
                          title={`Change price — ${s.name}`}
                          description={`Current price: ${fmtIQD(s.basePrice)}. Price changes are high-risk audited actions.`}
                          action={updateServicePrice}
                          submitLabel="Change price"
                        >
                          <input type="hidden" name="serviceId" value={s.id} />
                          <div>
                            <Label htmlFor={`pp-${s.id}`} required>New price (IQD)</Label>
                            <Input id={`pp-${s.id}`} name="basePrice" type="number" min={0} step="1000" defaultValue={s.basePrice} required />
                          </div>
                          <div>
                            <Label htmlFor={`pr-${s.id}`} required>Reason</Label>
                            <Input id={`pr-${s.id}`} name="reason" placeholder="Why is the price changing?" required />
                          </div>
                          <label className="flex items-center gap-2 text-[13px] text-body">
                            <input type="checkbox" name="active" defaultChecked={s.active} className="h-3.5 w-3.5 accent-[#171717]" />
                            Service active
                          </label>
                        </ActionDialog>
                        <ActionDialog
                          trigger="Recipe"
                          triggerSize="sm"
                          title={`Expected assets — ${s.name}`}
                          description="Define the consumables one test is expected to use. Actual usage is compared against this for waste and variance review."
                          action={addRecipeItem}
                          submitLabel="Add asset"
                        >
                          <input type="hidden" name="serviceId" value={s.id} />
                          <div>
                            <Label htmlFor={`ri-${s.id}`} required>Inventory item</Label>
                            <Select id={`ri-${s.id}`} name="inventoryItemId" required>
                              {inventoryItems.length === 0 && <option value="">No items — add inventory first</option>}
                              {inventoryItems.map((i) => (
                                <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                              ))}
                            </Select>
                            <Hint>Items come from this branch&apos;s inventory.</Hint>
                          </div>
                          <div className="grid grid-cols-2 items-end gap-4">
                            <div>
                              <Label htmlFor={`rq-${s.id}`} required>Quantity per test</Label>
                              <Input id={`rq-${s.id}`} name="quantity" type="number" min={0.1} step="0.1" defaultValue={1} required />
                            </div>
                            <label className="flex h-9 items-center gap-2 text-[13px] text-body">
                              <input type="checkbox" name="optional" className="h-3.5 w-3.5 accent-[#171717]" />
                              Optional
                            </label>
                          </div>
                        </ActionDialog>
                      </span>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <div className="space-y-4">
          {/* Machines */}
          <Card>
            <CardHeader title="Machines" subtitle="Primary equipment and status" />
            <CardBody>
              {department.machines.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-mute">No machines registered for this department.</p>
              ) : (
                <ul className="space-y-2.5">
                  {department.machines.map((m) => (
                    <li key={m.id} className="border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[13px] font-medium text-ink">{m.name}</p>
                          <p className="text-[11.5px] text-mute">{m.model ?? "—"}{m.serialNumber ? ` · SN ${m.serialNumber}` : ""}</p>
                        </div>
                        <Badge tone={statusTone(m.status)} dot>
                          {MACHINE_STATUS_LABELS[m.status as keyof typeof MACHINE_STATUS_LABELS]}
                        </Badge>
                      </div>
                      {writable && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {MACHINE_STATUSES.filter((st) => st !== m.status).map((st) => (
                            <ActionButton
                              key={st}
                              label={`→ ${MACHINE_STATUS_LABELS[st]}`}
                              variant="ghost"
                              size="sm"
                              action={setMachineStatus}
                              confirmTitle={`Set ${m.name} to ${MACHINE_STATUS_LABELS[st]}?`}
                              confirmDescription="Machine status changes affect queue capacity and are audited."
                              requireReason
                              hidden={{ machineId: m.id, status: st }}
                            />
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Pricing windows */}
          <Card>
            <CardHeader
              title="Time-based pricing"
              subtitle="Price multipliers by time of day"
              actions={
                writable ? (
                  <ActionDialog
                    trigger={<><Plus size={12} /> Window</>}
                    triggerSize="sm"
                    title={`Add pricing window — ${department.name}`}
                    description="Example: 08:00–14:00 standard ×1.0, 14:00–21:30 evening ×1.15."
                    action={createPricingWindow}
                    submitLabel="Add window"
                  >
                    <input type="hidden" name="departmentId" value={department.id} />
                    <div>
                      <Label htmlFor="pw-name" required>Name</Label>
                      <Input id="pw-name" name="name" placeholder="Evening window" required />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label htmlFor="pw-start" required>From</Label>
                        <Input id="pw-start" name="startTime" placeholder="14:00" required />
                      </div>
                      <div>
                        <Label htmlFor="pw-end" required>To</Label>
                        <Input id="pw-end" name="endTime" placeholder="21:30" required />
                      </div>
                      <div>
                        <Label htmlFor="pw-mult" required>Multiplier</Label>
                        <Input id="pw-mult" name="priceMultiplier" type="number" step="0.05" min="0.1" max="5" defaultValue={1} required />
                      </div>
                    </div>
                  </ActionDialog>
                ) : undefined
              }
            />
            <CardBody>
              {department.pricingWindows.length === 0 ? (
                <p className="py-2 text-center text-[13px] text-mute">No pricing windows — base prices apply all day.</p>
              ) : (
                <ul className="space-y-2">
                  {department.pricingWindows.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2 first:border-0 first:pt-0">
                      <div>
                        <p className="text-[13px] font-medium text-ink">
                          {w.name}
                          {activeWindow?.id === w.id && <Badge tone="good" className="ml-2">Active now</Badge>}
                        </p>
                        <p className="text-[11.5px] text-mute">{w.startTime}–{w.endTime} · ×{w.priceMultiplier}</p>
                      </div>
                      {writable && (
                        <ActionButton
                          label={<Trash2 size={12} />}
                          variant="danger"
                          size="sm"
                          action={deletePricingWindow}
                          confirmTitle={`Remove window “${w.name}”?`}
                          confirmDescription="Base prices will apply during this period. This action is audited."
                          hidden={{ windowId: w.id }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
