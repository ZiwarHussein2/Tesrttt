import type { Metadata } from "next";
import Link from "next/link";
import { ListOrdered, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite } from "@/lib/permissions";
import { ageRange, fmtIQD, fmtNumber, fmtTime, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ActionButton, ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, Hint } from "@/components/ui/input";
import {
  DEPARTMENT_TYPE_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, VISIT_STATUS_LABELS,
} from "@/types/enums";
import {
  assignReportDoctor, cancelVisit, completeReport, recordPayment, registerVisit,
  requeueVisit, rescheduleVisit, setVisitPriority, transitionVisit,
} from "./actions";

export const metadata: Metadata = { title: "Queues" };

export default async function QueuesPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const user = await requireUser("queues");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "queues");

  const departments = await db.department.findMany({
    where: { branchId: { in: scope.branchIds }, status: "ACTIVE" },
    include: {
      branch: { select: { name: true } },
      _count: { select: { visits: { where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } } } } },
    },
    orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
  });

  const department = sp.department
    ? departments.find((d) => d.id === sp.department) ?? null
    : null;

  if (!department) {
    return (
      <>
        <PageHeader
          title="Queues"
          subtitle="Select a department to operate its live patient queue."
        />
        {departments.length === 0 ? (
          <EmptyState
            icon={<ListOrdered size={18} strokeWidth={1.5} />}
            title="No active departments"
            description="Create branch departments first — each department runs its own queue."
            action={<Link href="/branches" className="text-[13px] font-medium text-link hover:underline">Go to branches</Link>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {departments.map((d) => (
              <Link
                key={d.id}
                href={`/queues?department=${d.id}`}
                className="group rounded-lg bg-canvas p-4 shadow-card transition-shadow hover:shadow-card-hover"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink group-hover:underline">{d.name}</p>
                    <p className="text-[12px] text-mute">{d.branch.name} · {DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold tabular-nums text-ink">{d._count.visits}</p>
                    <p className="text-[11px] text-mute">in queue</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [services, reportDoctors, referralDoctors, active, awaitingReports, closedToday, rescheduled] = await Promise.all([
    db.service.findMany({ where: { departmentId: department.id, active: true }, orderBy: { name: "asc" } }),
    db.reportDoctor.findMany({ where: { contractStatus: "ACTIVE" }, orderBy: { name: "asc" } }),
    db.referralDoctor.findMany({ where: { contractStatus: "ACTIVE" }, orderBy: { name: "asc" } }),
    db.visit.findMany({
      where: { departmentId: department.id, status: { in: ["REGISTERED", "PAID", "WAITING", "CALLED", "IN_PROGRESS"] } },
      include: { patient: true, service: { select: { name: true } } },
      orderBy: [{ priority: "asc" }, { registeredAt: "asc" }], // NORMAL < URGENT alphabetically — fix below
    }),
    db.visit.findMany({
      where: { departmentId: department.id, status: { in: ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING", "REPORT_COMPLETED"] } },
      include: { patient: true, service: { select: { name: true } }, reportDoctor: { select: { name: true } } },
      orderBy: { scanCompletedAt: "asc" },
    }),
    db.visit.findMany({
      where: { departmentId: department.id, status: { in: ["COMPLETED", "CANCELLED"] }, updatedAt: { gte: todayStart } },
      include: { patient: true, service: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.visit.findMany({
      where: { departmentId: department.id, status: "RESCHEDULED" },
      include: { patient: true, service: { select: { name: true } } },
      orderBy: { rescheduledTo: "asc" },
      take: 10,
    }),
  ]);

  // Urgent first, then FIFO.
  active.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "URGENT" ? -1 : 1;
    return a.registeredAt.getTime() - b.registeredAt.getTime();
  });

  const isSonar = department.type === "SONAR";
  const waiting = active.filter((v) => ["PAID", "WAITING"].includes(v.status)).length;
  const inProgress = active.filter((v) => v.status === "IN_PROGRESS").length;
  const completedToday = closedToday.filter((v) => v.status === "COMPLETED").length;

  const registerDialog = writable && (
    <ActionDialog
      trigger={<><Plus size={14} /> Register patient</>}
      triggerVariant="primary"
      title={`Register — ${department.name}`}
      description="Look up an existing patient by reference, or enter a new patient. Price comes from the service and the active pricing window."
      action={registerVisit}
      submitLabel="Register visit"
      wide
    >
      <input type="hidden" name="departmentId" value={department.id} />
      <div>
        <Label htmlFor="rv-service" required>Service</Label>
        <Select id="rv-service" name="serviceId" required>
          {services.length === 0 && <option value="">No active services — add them on the department page</option>}
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {fmtIQD(s.basePrice)}{s.reportRequired ? " (report)" : ""}</option>
          ))}
        </Select>
      </div>
      <div className="rounded-md bg-canvas-soft p-3">
        <Label htmlFor="rv-ref">Existing patient reference</Label>
        <Input id="rv-ref" name="patientRef" placeholder="MRN-XXXXXXXX" />
        <Hint>Leave empty to register a new patient below.</Hint>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="rv-first">First name</Label>
          <Input id="rv-first" name="firstName" />
        </div>
        <div>
          <Label htmlFor="rv-last">Last name</Label>
          <Input id="rv-last" name="lastName" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="rv-year">Birth year</Label>
          <Input id="rv-year" name="birthYear" type="number" min={1900} max={new Date().getFullYear()} />
        </div>
        <div>
          <Label htmlFor="rv-gender">Gender</Label>
          <Select id="rv-gender" name="gender" defaultValue="">
            <option value="">—</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="UNDISCLOSED">Undisclosed</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="rv-phone">Phone</Label>
          <Input id="rv-phone" name="phone" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="rv-referral">Referred by</Label>
          <Select id="rv-referral" name="referralDoctorId" defaultValue="">
            <option value="">— No referral —</option>
            {referralDoctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="rv-priority">Priority</Label>
          <Select id="rv-priority" name="priority" defaultValue="NORMAL">
            <option value="NORMAL">Normal</option>
            <option value="URGENT">Urgent</option>
          </Select>
        </div>
      </div>
    </ActionDialog>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Queues", href: "/queues" }, { label: department.name }]}
        title={`${department.name} queue`}
        subtitle={`${department.branch.name} · ${department.operatingHoursStart}–${department.operatingHoursEnd} · wait target ${department.targetWaitMinutes} min${isSonar ? " · Sonar workflow: doctor writes the report during the examination" : ""}`}
        actions={
          <>
            <Link href={`/departments/${department.id}`} className="inline-flex h-8 items-center rounded-md border border-hairline px-2.5 text-[13px] text-body hover:border-hairline-strong hover:text-ink">
              Department page
            </Link>
            {registerDialog}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Waiting" value={fmtNumber(waiting)} tone={waiting > department.dailyCapacity / 4 ? "warning" : undefined} />
        <KpiCard label="In progress" value={fmtNumber(inProgress)} />
        <KpiCard label="Awaiting reports" value={fmtNumber(awaitingReports.filter((v) => v.status !== "REPORT_COMPLETED").length)} />
        <KpiCard label="Completed today" value={fmtNumber(completedToday)} />
      </div>

      {/* Active queue */}
      <Card className="mb-4">
        <CardHeader title="Active queue" subtitle="Urgent first, then order of registration. Every action is audited." />
        <TableShell className="rounded-t-none shadow-none" dense>
          <THead>
            <Th>#</Th><Th>Visit</Th><Th>Patient</Th><Th>Service</Th><Th align="right">Price</Th>
            <Th>Payment</Th><Th>Status</Th><Th align="right">Registered</Th>
            {writable && <Th align="right">Actions</Th>}
          </THead>
          <tbody>
            {active.length === 0 && <TableEmpty colSpan={writable ? 9 : 8}>The queue is empty.</TableEmpty>}
            {active.map((v, i) => {
              const due = v.price - v.discountAmount - v.paidAmount;
              return (
                <Tr key={v.id} highlight={v.priority === "URGENT"}>
                  <Td className="text-mute">{i + 1}</Td>
                  <Td mono>{v.visitNumber}{v.priority === "URGENT" && <Badge tone="critical" className="ml-1.5">Urgent</Badge>}</Td>
                  <Td>
                    <span className="font-medium text-ink">{maskName(v.patient.firstName, v.patient.lastName)}</span>
                    <span className="block font-mono text-[10px] text-mute">{v.patient.publicRef} · {ageRange(v.patient.birthYear)}</span>
                  </Td>
                  <Td>{v.service?.name ?? "—"}</Td>
                  <Td align="right">
                    {fmtIQD(v.price - v.discountAmount)}
                    {v.discountAmount > 0 && <span className="block text-[10px] text-good-deep">−{fmtIQD(v.discountAmount)} discount</span>}
                  </Td>
                  <Td><Badge tone={statusTone(v.paymentStatus)} dot>{v.paymentStatus.toLowerCase()}</Badge></Td>
                  <Td><Badge tone={statusTone(v.status)}>{VISIT_STATUS_LABELS[v.status as keyof typeof VISIT_STATUS_LABELS]}</Badge></Td>
                  <Td align="right" className="text-mute">{fmtTime(v.registeredAt)}</Td>
                  {writable && (
                    <Td align="right">
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {due > 0 && v.paymentStatus !== "REFUNDED" && (
                          <ActionDialog
                            trigger="Payment"
                            triggerSize="sm"
                            triggerVariant="primary"
                            title={`Record payment — ${v.visitNumber}`}
                            description={`Outstanding: ${fmtIQD(due)}. Payment creates the income entry automatically.`}
                            action={recordPayment}
                            submitLabel="Record payment"
                          >
                            <input type="hidden" name="visitId" value={v.id} />
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label htmlFor={`pa-${v.id}`} required>Amount (IQD)</Label>
                                <Input id={`pa-${v.id}`} name="amount" type="number" min={1} step="250" defaultValue={due} required />
                              </div>
                              <div>
                                <Label htmlFor={`pm-${v.id}`}>Method</Label>
                                <Select id={`pm-${v.id}`} name="method" defaultValue="CASH">
                                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                                </Select>
                              </div>
                            </div>
                            <div>
                              <Label htmlFor={`pc-${v.id}`}>Discount code</Label>
                              <Input id={`pc-${v.id}`} name="discountCode" placeholder="Optional" />
                            </div>
                          </ActionDialog>
                        )}
                        {["PAID", "WAITING"].includes(v.status) && (
                          <ActionButton label="Call" size="sm" action={transitionVisit} hidden={{ visitId: v.id, transition: "call" }} />
                        )}
                        {["CALLED", "WAITING", "PAID"].includes(v.status) && v.paymentStatus !== "UNPAID" && (
                          <ActionButton label={isSonar ? "Open" : "Start"} size="sm" action={transitionVisit} hidden={{ visitId: v.id, transition: "start" }} />
                        )}
                        {v.status === "IN_PROGRESS" && !isSonar && (
                          <ActionButton label="Scan done" size="sm" variant="primary" action={transitionVisit} hidden={{ visitId: v.id, transition: "complete-scan" }} />
                        )}
                        {v.status === "IN_PROGRESS" && isSonar && (
                          <ActionDialog
                            trigger="Write report"
                            triggerSize="sm"
                            triggerVariant="primary"
                            title={`Sonar report — ${v.visitNumber}`}
                            description="The doctor writes the report directly during the examination."
                            action={completeReport}
                            submitLabel="Save report & mark done"
                            wide
                          >
                            <input type="hidden" name="visitId" value={v.id} />
                            <div>
                              <Label htmlFor={`rt-${v.id}`} required>Report</Label>
                              <Textarea id={`rt-${v.id}`} name="reportText" required className="min-h-[140px]" />
                            </div>
                          </ActionDialog>
                        )}
                        <ActionButton
                          label={v.priority === "URGENT" ? "Unmark urgent" : "Urgent"}
                          size="sm"
                          variant="ghost"
                          action={setVisitPriority}
                          confirmTitle={v.priority === "URGENT" ? "Return to normal priority?" : "Mark as urgent?"}
                          requireReason={v.priority !== "URGENT"}
                          hidden={{ visitId: v.id }}
                        />
                        <ActionDialog
                          trigger="More"
                          triggerSize="sm"
                          triggerVariant="ghost"
                          title={`Visit ${v.visitNumber}`}
                          description={`${maskName(v.patient.firstName, v.patient.lastName)} · ${v.service?.name ?? ""} · ${VISIT_STATUS_LABELS[v.status as keyof typeof VISIT_STATUS_LABELS]}`}
                          action={rescheduleVisit}
                          submitLabel="Reschedule"
                        >
                          <input type="hidden" name="visitId" value={v.id} />
                          <div>
                            <Label htmlFor={`rs-${v.id}`} required>Reschedule to</Label>
                            <Input id={`rs-${v.id}`} name="rescheduledTo" type="datetime-local" required />
                          </div>
                          <div>
                            <Label htmlFor={`rsr-${v.id}`} required>Reason</Label>
                            <Textarea id={`rsr-${v.id}`} name="reason" required />
                          </div>
                        </ActionDialog>
                        <ActionButton
                          label="Cancel"
                          size="sm"
                          variant="danger"
                          action={cancelVisit}
                          confirmTitle={`Cancel visit ${v.visitNumber}?`}
                          confirmDescription={v.paidAmount > 0 ? `A refund entry of ${fmtIQD(v.paidAmount)} will be recorded.` : undefined}
                          requireReason
                          hidden={{ visitId: v.id }}
                        />
                      </span>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>

      {/* Post-scan pipeline */}
      <Card className="mb-4">
        <CardHeader
          title={isSonar ? "Completed examinations" : "Scan → print → report pipeline"}
          subtitle={isSonar ? "Print the report and complete the visit" : "Film printing, report assignment and completion"}
        />
        <TableShell className="rounded-t-none shadow-none" dense>
          <THead>
            <Th>Visit</Th><Th>Patient</Th><Th>Service</Th><Th>Status</Th><Th>Report doctor</Th>
            {writable && <Th align="right">Actions</Th>}
          </THead>
          <tbody>
            {awaitingReports.length === 0 && <TableEmpty colSpan={writable ? 6 : 5}>Nothing in the pipeline.</TableEmpty>}
            {awaitingReports.map((v) => (
              <Tr key={v.id}>
                <Td mono>{v.visitNumber}</Td>
                <Td>
                  <span className="font-medium text-ink">{maskName(v.patient.firstName, v.patient.lastName)}</span>
                  <span className="block font-mono text-[10px] text-mute">{v.patient.publicRef}</span>
                </Td>
                <Td>{v.service?.name ?? "—"}</Td>
                <Td><Badge tone={statusTone(v.status)}>{VISIT_STATUS_LABELS[v.status as keyof typeof VISIT_STATUS_LABELS]}</Badge></Td>
                <Td>{v.reportDoctor?.name ?? (v.reportRequired ? <Badge tone="warning">Unassigned</Badge> : "Not required")}</Td>
                {writable && (
                  <Td align="right">
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {v.status === "SCAN_COMPLETED" && (
                        <ActionButton label="Printing done" size="sm" action={transitionVisit} hidden={{ visitId: v.id, transition: "complete-printing" }} />
                      )}
                      {v.reportRequired && ["SCAN_COMPLETED", "PRINTING_COMPLETED"].includes(v.status) && (
                        <ActionDialog
                          trigger="Assign doctor"
                          triggerSize="sm"
                          title={`Assign report doctor — ${v.visitNumber}`}
                          description="Entering a rate different from the agreed rate creates a rate exception in the audit log."
                          action={assignReportDoctor}
                          submitLabel="Assign"
                        >
                          <input type="hidden" name="visitId" value={v.id} />
                          <div>
                            <Label htmlFor={`ad-${v.id}`} required>Report doctor</Label>
                            <Select id={`ad-${v.id}`} name="reportDoctorId" required>
                              {reportDoctors.length === 0 && <option value="">No active report doctors — add them in Report Workflow</option>}
                              {reportDoctors.map((d) => (
                                <option key={d.id} value={d.id}>{d.name} — agreed {fmtIQD(d.agreedRate)}</option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`ar-${v.id}`}>Rate (IQD)</Label>
                            <Input id={`ar-${v.id}`} name="rate" type="number" min={0} step="1000" placeholder="Defaults to agreed rate" />
                          </div>
                          <div>
                            <Label htmlFor={`arr-${v.id}`}>Reason (required for rate exceptions)</Label>
                            <Input id={`arr-${v.id}`} name="reason" />
                          </div>
                        </ActionDialog>
                      )}
                      {v.status === "REPORT_PENDING" && (
                        <ActionDialog
                          trigger="Complete report"
                          triggerSize="sm"
                          triggerVariant="primary"
                          title={`Report — ${v.visitNumber}`}
                          action={completeReport}
                          submitLabel="Save report"
                          wide
                        >
                          <input type="hidden" name="visitId" value={v.id} />
                          <div>
                            <Label htmlFor={`crt-${v.id}`} required>Report text</Label>
                            <Textarea id={`crt-${v.id}`} name="reportText" required className="min-h-[140px]" />
                          </div>
                        </ActionDialog>
                      )}
                      {(v.status === "REPORT_COMPLETED" || (!v.reportRequired && ["SCAN_COMPLETED", "PRINTING_COMPLETED"].includes(v.status))) && (
                        <ActionButton label="Complete visit" size="sm" variant="primary" action={transitionVisit} hidden={{ visitId: v.id, transition: "complete-visit" }} />
                      )}
                    </span>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rescheduled" />
          <CardBody>
            {rescheduled.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-mute">No rescheduled visits.</p>
            ) : (
              <ul className="space-y-2">
                {rescheduled.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2 first:border-0 first:pt-0">
                    <div>
                      <p className="font-mono text-[12px] text-ink">{v.visitNumber}</p>
                      <p className="text-[11.5px] text-mute">
                        {maskName(v.patient.firstName, v.patient.lastName)} · {v.service?.name} · to {v.rescheduledTo?.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {writable && <ActionButton label="Re-queue" size="sm" action={requeueVisit} hidden={{ visitId: v.id }} />}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Closed today" />
          <CardBody>
            {closedToday.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-mute">No completed or cancelled visits today.</p>
            ) : (
              <ul className="space-y-2">
                {closedToday.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2 first:border-0 first:pt-0">
                    <div>
                      <p className="font-mono text-[12px] text-ink">{v.visitNumber}</p>
                      <p className="text-[11.5px] text-mute">{maskName(v.patient.firstName, v.patient.lastName)} · {v.service?.name}</p>
                    </div>
                    <Badge tone={statusTone(v.status)} dot>{v.status.toLowerCase()}</Badge>
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
