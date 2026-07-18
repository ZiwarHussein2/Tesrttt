import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite } from "@/lib/permissions";
import { fmtDateTime, fmtIQD, fmtIQDCompact, fmtNumber, maskName, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import { createReportDoctor, recordDoctorPayment, updateReportDoctor } from "../doctors-actions";

export const metadata: Metadata = { title: "Report Workflow" };

export default async function ReportWorkflowPage() {
  const user = await requireUser("report-workflow");
  const scope = await getScope(user);
  const writable = canWrite(user.role, "report-workflow");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [backlog, doctors, completedInPeriod, scansCompleted] = await Promise.all([
    db.visit.findMany({
      where: {
        branchId: { in: scope.branchIds },
        reportRequired: true,
        status: { in: ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING"] },
      },
      include: {
        patient: { select: { publicRef: true, firstName: true, lastName: true } },
        department: { select: { id: true, name: true } },
        branch: { select: { name: true } },
        reportDoctor: { select: { id: true, name: true } },
        service: { select: { name: true } },
      },
      orderBy: { scanCompletedAt: "asc" },
    }),
    db.reportDoctor.findMany({
      include: {
        visits: {
          where: { branchId: { in: scope.branchIds } },
          select: { status: true, reportRate: true, reportCompletedAt: true, reportAssignedAt: true, scanCompletedAt: true },
        },
        payments: { select: { amount: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.visit.findMany({
      where: {
        branchId: { in: scope.branchIds },
        reportCompletedAt: { gte: scope.from, lt: scope.to },
      },
      select: { scanCompletedAt: true, reportCompletedAt: true },
    }),
    db.visit.count({
      where: { branchId: { in: scope.branchIds }, scanCompletedAt: { gte: scope.from, lt: scope.to } },
    }),
  ]);

  const unassigned = backlog.filter((v) => !v.reportDoctorId);
  const overdueCutoff = Date.now() - 24 * 3600000;
  const overdue = backlog.filter((v) => v.scanCompletedAt && v.scanCompletedAt.getTime() < overdueCutoff);
  const turnarounds = completedInPeriod
    .filter((v) => v.scanCompletedAt && v.reportCompletedAt)
    .map((v) => (v.reportCompletedAt!.getTime() - v.scanCompletedAt!.getTime()) / 3600000)
    .filter((h) => h >= 0);
  const avgTurnaround = turnarounds.length ? turnarounds.reduce((s, h) => s + h, 0) / turnarounds.length : null;

  return (
    <>
      <PageHeader
        title="Report Workflow"
        subtitle="Completed scans that need a written doctor report — assignment, turnaround, workload and doctor liability."
        actions={
          <>
            <ExportCsvButton filename="merna-report-workflow.csv" />
            {writable && (
              <ActionDialog
                trigger={<><Plus size={14} /> Report doctor</>}
                triggerVariant="primary"
                title="Add report doctor"
                description="Remote reading doctors are paid per completed report at the agreed rate."
                action={createReportDoctor}
                submitLabel="Add doctor"
              >
                <div>
                  <Label htmlFor="rd-name" required>Name</Label>
                  <Input id="rd-name" name="name" placeholder="Dr. …" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rd-spec">Specialty</Label>
                    <Input id="rd-spec" name="specialty" placeholder="Radiologist" />
                  </div>
                  <div>
                    <Label htmlFor="rd-rate" required>Agreed rate / report (IQD)</Label>
                    <Input id="rd-rate" name="agreedRate" type="number" min={0} step="1000" required />
                  </div>
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Scans completed (period)" value={fmtNumber(scansCompleted)} />
        <KpiCard label="Reports needed now" value={fmtNumber(backlog.length)} />
        <KpiCard label="Unassigned" value={fmtNumber(unassigned.length)} tone={unassigned.length > 0 ? "warning" : undefined} />
        <KpiCard label="Overdue (>24h)" value={fmtNumber(overdue.length)} tone={overdue.length > 0 ? "critical" : undefined} />
        <KpiCard label="Completed (period)" value={fmtNumber(completedInPeriod.length)} />
        <KpiCard label="Avg turnaround" value={avgTurnaround !== null ? `${avgTurnaround.toFixed(1)}h` : "—"} definition="Scan completion → report completion." />
      </div>

      {backlog.length === 0 && doctors.length === 0 ? (
        <EmptyState
          icon={<FileText size={18} strokeWidth={1.5} />}
          title="No report workload"
          description="When scans with report requirements complete, they appear here for assignment to report doctors."
        />
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader
              title="Report backlog"
              subtitle="Oldest scans first — assign and complete from the department queue page"
            />
            <TableShell className="rounded-t-none shadow-none" dense>
              <THead>
                <Th>Visit</Th><Th>Patient</Th><Th>Service</Th><Th>Branch</Th><Th>Status</Th>
                <Th>Doctor</Th><Th align="right">Scan completed</Th><Th align="right">Age</Th><Th align="right">Open</Th>
              </THead>
              <tbody>
                {backlog.length === 0 && <TableEmpty colSpan={9}>No reports pending. 🎉</TableEmpty>}
                {backlog.map((v) => {
                  const isOverdue = v.scanCompletedAt && v.scanCompletedAt.getTime() < overdueCutoff;
                  return (
                    <Tr key={v.id} highlight={!!isOverdue}>
                      <Td mono>{v.visitNumber}</Td>
                      <Td>
                        {maskName(v.patient.firstName, v.patient.lastName)}
                        <span className="block font-mono text-[10px] text-mute">{v.patient.publicRef}</span>
                      </Td>
                      <Td>{v.service?.name ?? "—"}</Td>
                      <Td>{v.branch.name}</Td>
                      <Td><Badge tone={statusTone(v.status)}>{v.status.replace(/_/g, " ").toLowerCase()}</Badge></Td>
                      <Td>{v.reportDoctor?.name ?? <Badge tone="warning">Unassigned</Badge>}</Td>
                      <Td align="right" className="text-mute">{fmtDateTime(v.scanCompletedAt)}</Td>
                      <Td align="right" className={isOverdue ? "font-medium text-critical-deep" : "text-mute"}>
                        {relativeTime(v.scanCompletedAt)}
                      </Td>
                      <Td align="right">
                        <Link href={`/queues?department=${v.department.id}`} className="text-[12px] font-medium text-link hover:underline">
                          Queue
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </Card>

          <Card>
            <CardHeader
              title="Report doctors"
              subtitle="Workload, earnings and remote-access posture. Rate changes require a reason."
            />
            <div id="export-region">
              <TableShell className="rounded-t-none shadow-none" dense>
                <THead>
                  <Th>Doctor</Th><Th align="right">Active</Th><Th align="right">Completed today</Th>
                  <Th align="right">Avg turnaround</Th><Th align="right">Agreed rate</Th>
                  <Th align="right">Earned</Th><Th align="right">Paid</Th><Th align="right">Outstanding</Th>
                  <Th>Remote access</Th><Th>Status</Th>
                  {writable && <Th align="right">Actions</Th>}
                </THead>
                <tbody>
                  {doctors.length === 0 && <TableEmpty colSpan={writable ? 11 : 10}>No report doctors registered.</TableEmpty>}
                  {doctors.map((d) => {
                    const active = d.visits.filter((v) => v.status === "REPORT_PENDING").length;
                    const completedToday = d.visits.filter((v) => v.reportCompletedAt && v.reportCompletedAt >= todayStart).length;
                    const dTurns = d.visits
                      .filter((v) => v.scanCompletedAt && v.reportCompletedAt)
                      .map((v) => (v.reportCompletedAt!.getTime() - v.scanCompletedAt!.getTime()) / 3600000);
                    const avgT = dTurns.length ? dTurns.reduce((s, h) => s + h, 0) / dTurns.length : null;
                    const earned = d.visits.filter((v) => v.reportCompletedAt).reduce((s, v) => s + (v.reportRate ?? 0), 0);
                    const paid = d.payments.reduce((s, p) => s + p.amount, 0);
                    const outstanding = earned - paid;
                    return (
                      <Tr key={d.id}>
                        <Td>
                          <span className="font-medium text-ink">{d.name}</span>
                          <span className="block text-[10.5px] text-mute">{d.specialty ?? ""}</span>
                        </Td>
                        <Td align="right">{fmtNumber(active)}</Td>
                        <Td align="right">{fmtNumber(completedToday)}</Td>
                        <Td align="right">{avgT !== null ? `${avgT.toFixed(1)}h` : "—"}</Td>
                        <Td align="right">{fmtIQD(d.agreedRate)}</Td>
                        <Td align="right">{fmtIQDCompact(earned)}</Td>
                        <Td align="right">{fmtIQDCompact(paid)}</Td>
                        <Td align="right" className={outstanding > 0 ? "font-medium text-warning-deep" : undefined}>
                          {fmtIQDCompact(Math.max(0, outstanding))}
                        </Td>
                        <Td>
                          <span className="flex flex-wrap gap-1">
                            <Badge tone={d.approvedDevice ? "good" : "warning"}>{d.approvedDevice ? "Approved device" : "Device unverified"}</Badge>
                            {d.lastAccessRegion && <Badge tone="neutral">{d.lastAccessRegion}</Badge>}
                            {d.suspiciousFlag && <Badge tone="critical">Requires review</Badge>}
                          </span>
                        </Td>
                        <Td><Badge tone={statusTone(d.contractStatus)} dot>{d.contractStatus.toLowerCase()}</Badge></Td>
                        {writable && (
                          <Td align="right">
                            <span className="flex justify-end gap-1.5">
                              <ActionDialog
                                trigger="Edit"
                                triggerSize="sm"
                                title={`Edit — ${d.name}`}
                                description="Rate changes are high-risk audited actions and require a reason."
                                action={updateReportDoctor}
                                submitLabel="Save"
                              >
                                <input type="hidden" name="doctorId" value={d.id} />
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <Label htmlFor={`rr-${d.id}`}>Agreed rate (IQD)</Label>
                                    <Input id={`rr-${d.id}`} name="agreedRate" type="number" min={0} step="1000" defaultValue={d.agreedRate} />
                                  </div>
                                  <div>
                                    <Label htmlFor={`rc-${d.id}`}>Contract</Label>
                                    <Select id={`rc-${d.id}`} name="contractStatus" defaultValue={d.contractStatus}>
                                      <option value="ACTIVE">Active</option>
                                      <option value="SUSPENDED">Suspended</option>
                                      <option value="ENDED">Ended</option>
                                    </Select>
                                  </div>
                                </div>
                                <div>
                                  <Label htmlFor={`rg-${d.id}`}>Last access region</Label>
                                  <Input id={`rg-${d.id}`} name="lastAccessRegion" defaultValue={d.lastAccessRegion ?? ""} placeholder="e.g. Erbil, IQ" />
                                </div>
                                <label className="flex items-center gap-2 text-[13px] text-body">
                                  <input type="checkbox" name="approvedDevice" defaultChecked={d.approvedDevice} className="h-3.5 w-3.5 accent-[#171717]" />
                                  Device approved
                                </label>
                                <label className="flex items-center gap-2 text-[13px] text-body">
                                  <input type="checkbox" name="suspiciousFlag" defaultChecked={d.suspiciousFlag} className="h-3.5 w-3.5 accent-[#171717]" />
                                  Flag for review (suspicious access)
                                </label>
                                <div>
                                  <Label htmlFor={`re-${d.id}`}>Reason (required for rate changes)</Label>
                                  <Input id={`re-${d.id}`} name="reason" />
                                </div>
                              </ActionDialog>
                              {outstanding > 0 && (
                                <ActionDialog
                                  trigger="Pay"
                                  triggerSize="sm"
                                  triggerVariant="primary"
                                  title={`Record payment — ${d.name}`}
                                  description={`Outstanding: ${fmtIQD(Math.max(0, outstanding))}. Posts an approved professional-fees expense.`}
                                  action={recordDoctorPayment}
                                  submitLabel="Record payment"
                                >
                                  <input type="hidden" name="reportDoctorId" value={d.id} />
                                  <div>
                                    <Label htmlFor={`pa2-${d.id}`} required>Amount (IQD)</Label>
                                    <Input id={`pa2-${d.id}`} name="amount" type="number" min={1} step="1000" defaultValue={Math.max(0, outstanding)} required />
                                  </div>
                                  <div>
                                    <Label htmlFor={`pm2-${d.id}`}>Method</Label>
                                    <Select id={`pm2-${d.id}`} name="method" defaultValue="TRANSFER">
                                      <option value="CASH">Cash</option>
                                      <option value="CARD">Card</option>
                                      <option value="TRANSFER">Bank transfer</option>
                                    </Select>
                                  </div>
                                  <Hint>Payment reduces the doctor&apos;s outstanding liability.</Hint>
                                </ActionDialog>
                              )}
                            </span>
                          </Td>
                        )}
                      </Tr>
                    );
                  })}
                </tbody>
              </TableShell>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
