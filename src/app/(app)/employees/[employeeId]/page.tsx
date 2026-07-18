import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSignature, Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canWrite, isBranchScoped, maskingFor } from "@/lib/permissions";
import {
  fmtDate, fmtDateTime, fmtDuration, fmtIQD, fmtNumber, fmtTime,
  maskEmail, maskName, maskPhone,
} from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ActionDialog, ActionButton } from "@/components/ui/dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { Input, Label, Select, Textarea, Hint } from "@/components/ui/input";
import {
  ATTENDANCE_STATUS_LABELS, AGREEMENT_STATUS_LABELS, EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS, LOCATION_STATUS_LABELS, POLICY_CATEGORY_LABELS,
} from "@/types/enums";
import { updateEmployee } from "../actions";
import { correctAttendance, recordAttendance } from "../../attendance/actions";
import { issueAgreement, recordAcceptance, terminateAgreement } from "../../agreements/actions";
import { recordPolicyAcceptance } from "../../policies/actions";

export const metadata: Metadata = { title: "Employee" };

const TABS = ["overview", "attendance", "agreements", "policies", "expenses", "payroll", "access", "audit"] as const;
type Tab = (typeof TABS)[number];

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser("employees");
  const { employeeId } = await params;
  const sp = await searchParams;
  const masking = maskingFor(user.role);

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      branch: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      user: { select: { id: true, email: true, role: true, isActive: true, lastLoginAt: true, mfaEnabled: true } },
    },
  });
  if (!employee) notFound();
  if (isBranchScoped(user.role) && user.branchId !== employee.branchId) notFound();

  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const name = masking.employeeContact
    ? maskName(employee.firstName, employee.lastName)
    : `${employee.firstName} ${employee.lastName}`;
  const writable = canWrite(user.role, "employees");

  const departments = await db.department.findMany({
    where: { branchId: employee.branchId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Employees", href: "/employees" }, { label: name }]}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {name}
            <Badge tone={statusTone(employee.employmentStatus)} dot>
              {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus as keyof typeof EMPLOYMENT_STATUS_LABELS]}
            </Badge>
          </span>
        }
        subtitle={`${employee.jobTitle} · ${employee.branch.name}${employee.department ? ` · ${employee.department.name}` : ""} · ${employee.employeeCode}`}
        actions={
          writable ? (
            <ActionDialog
              trigger={<><Pencil size={13} /> Edit / assign</>}
              title="Edit employee"
              description="Position, compensation and status changes require a reason and are audited."
              action={updateEmployee}
              submitLabel="Save changes"
              wide
            >
              <input type="hidden" name="employeeId" value={employee.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ee-title" required>Job title</Label>
                  <Input id="ee-title" name="jobTitle" defaultValue={employee.jobTitle} required />
                </div>
                <div>
                  <Label htmlFor="ee-status">Employment status</Label>
                  <Select id="ee-status" name="employmentStatus" defaultValue={employee.employmentStatus}>
                    {EMPLOYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{EMPLOYMENT_STATUS_LABELS[s]}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ee-dept">Department</Label>
                  <Select id="ee-dept" name="departmentId" defaultValue={employee.departmentId ?? ""}>
                    <option value="">— None —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ee-salary">Base salary (IQD)</Label>
                  <Input id="ee-salary" name="baseSalary" type="number" min={0} step="10000" defaultValue={employee.baseSalary} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <Label htmlFor="ee-ws">Shift start</Label>
                  <Input id="ee-ws" name="workScheduleStart" defaultValue={employee.workScheduleStart} />
                </div>
                <div>
                  <Label htmlFor="ee-we">Shift end</Label>
                  <Input id="ee-we" name="workScheduleEnd" defaultValue={employee.workScheduleEnd} />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="ee-phone">Phone</Label>
                  <Input id="ee-phone" name="phone" defaultValue={employee.phone ?? ""} />
                </div>
              </div>
              <div>
                <Label htmlFor="ee-reason" required>Reason for change</Label>
                <Input id="ee-reason" name="reason" placeholder="Recorded in the audit log" required />
              </div>
            </ActionDialog>
          ) : undefined
        }
      />

      <Tabs
        tabs={TABS.map((t) => ({ key: t, label: t.charAt(0).toUpperCase() + t.slice(1), href: `/employees/${employeeId}?tab=${t}` }))}
        current={tab}
      />

      {tab === "overview" && <Overview employee={employee} masked={masking.employeeContact} salaryMasked={masking.employeeSalary} />}
      {tab === "attendance" && <Attendance employeeId={employeeId} writable={canWrite(user.role, "attendance")} />}
      {tab === "agreements" && <Agreements employee={employee} writable={canWrite(user.role, "agreements")} evidenceMasked={masking.legalEvidence} />}
      {tab === "policies" && <Policies employee={employee} writable={canWrite(user.role, "policies")} />}
      {tab === "expenses" && <Expenses employeeId={employeeId} />}
      {tab === "payroll" && <Payroll employeeId={employeeId} salaryMasked={masking.employeeSalary} />}
      {tab === "access" && <Access employee={employee} />}
      {tab === "audit" && <Audit employee={employee} />}
    </>
  );
}

type EmployeeFull = NonNullable<Awaited<ReturnType<typeof getEmployee>>>;
async function getEmployee(id: string) {
  return db.employee.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      user: { select: { id: true, email: true, role: true, isActive: true, lastLoginAt: true, mfaEnabled: true } },
    },
  });
}

function Overview({ employee, masked, salaryMasked }: { employee: EmployeeFull; masked: boolean; salaryMasked: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Position" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Employee code", value: <span className="font-mono">{employee.employeeCode}</span> },
              { label: "Job title", value: employee.jobTitle },
              { label: "Branch", value: employee.branch.name },
              { label: "Department", value: employee.department?.name ?? "—" },
              { label: "Start date", value: fmtDate(employee.startDate) },
              { label: "End date", value: employee.endDate ? fmtDate(employee.endDate) : "—" },
              { label: "Work schedule", value: `${employee.workScheduleStart} – ${employee.workScheduleEnd}` },
              { label: "Base salary", value: salaryMasked ? "•••• (restricted)" : fmtIQD(employee.baseSalary) },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Contact & identity" subtitle="Sensitive values are masked based on your role" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Email", value: masked ? maskEmail(employee.email) : employee.email ?? "—" },
              { label: "Phone", value: masked ? maskPhone(employee.phone) : employee.phone ?? "—" },
              { label: "System account", value: employee.user ? (employee.user.isActive ? "Active" : "Disabled") : "None" },
              { label: "Account role", value: employee.user?.role.replace(/_/g, " ") ?? "—" },
              { label: "Last login", value: employee.user?.lastLoginAt ? fmtDateTime(employee.user.lastLoginAt) : "—" },
              { label: "MFA", value: employee.user ? (employee.user.mfaEnabled ? "Enabled" : "Not enabled") : "—" },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

async function Attendance({ employeeId, writable }: { employeeId: string; writable: boolean }) {
  const records = await db.attendanceRecord.findMany({
    where: { employeeId },
    orderBy: { date: "desc" },
    take: 30,
  });
  const late = records.filter((r) => r.status === "LATE").length;
  const absent = records.filter((r) => r.status === "ABSENT").length;
  const overtime = records.reduce((s, r) => s + r.overtimeMinutes, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Records (last 30)" value={fmtNumber(records.length)} />
        <KpiCard label="Late" value={fmtNumber(late)} tone={late > 3 ? "warning" : undefined} />
        <KpiCard label="Absent" value={fmtNumber(absent)} tone={absent > 0 ? "warning" : undefined} />
        <KpiCard label="Overtime" value={fmtDuration(overtime)} />
      </div>

      <Card>
        <CardHeader
          title="Attendance history"
          subtitle="Corrections require a reason and keep the original values in the audit log"
          actions={
            writable ? (
              <ActionDialog
                trigger={<><Plus size={12} /> Record day</>}
                triggerSize="sm"
                title="Record attendance"
                description="Manual entry from the management panel. Device, network and location are marked as unverified."
                action={recordAttendance}
                submitLabel="Save record"
              >
                <input type="hidden" name="employeeId" value={employeeId} />
                <div>
                  <Label htmlFor="ar-date" required>Date</Label>
                  <Input id="ar-date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="ar-in">Check-in (HH:MM)</Label>
                    <Input id="ar-in" name="checkIn" placeholder="08:32" />
                  </div>
                  <div>
                    <Label htmlFor="ar-out">Check-out (HH:MM)</Label>
                    <Input id="ar-out" name="checkOut" placeholder="17:05" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="ar-status">Or mark day as</Label>
                  <Select id="ar-status" name="status" defaultValue="">
                    <option value="">— Derived from check-in —</option>
                    <option value="ABSENT">Absent</option>
                    <option value="LEAVE">On leave</option>
                    <option value="HOLIDAY">Holiday</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ar-notes">Notes</Label>
                  <Input id="ar-notes" name="notes" placeholder="Optional" />
                </div>
              </ActionDialog>
            ) : undefined
          }
        />
        <TableShell className="rounded-t-none shadow-none" dense>
          <THead>
            <Th>Date</Th><Th>Status</Th><Th align="right">In</Th><Th align="right">Out</Th>
            <Th align="right">Late</Th><Th align="right">Overtime</Th><Th>Location</Th><Th>Review</Th>
            {writable && <Th align="right">Actions</Th>}
          </THead>
          <tbody>
            {records.length === 0 && <TableEmpty colSpan={writable ? 9 : 8}>No attendance records yet.</TableEmpty>}
            {records.map((r) => (
              <Tr key={r.id} highlight={r.exception && r.reviewStatus === "PENDING"}>
                <Td>{fmtDate(r.date)}</Td>
                <Td><Badge tone={statusTone(r.status)} dot>{ATTENDANCE_STATUS_LABELS[r.status as keyof typeof ATTENDANCE_STATUS_LABELS]}</Badge></Td>
                <Td align="right">{fmtTime(r.checkIn)}</Td>
                <Td align="right">{fmtTime(r.checkOut)}</Td>
                <Td align="right">{r.lateMinutes > 0 ? `${r.lateMinutes}m` : "—"}</Td>
                <Td align="right">{r.overtimeMinutes > 0 ? fmtDuration(r.overtimeMinutes) : "—"}</Td>
                <Td className="text-[12px]">{LOCATION_STATUS_LABELS[r.locationStatus as keyof typeof LOCATION_STATUS_LABELS] ?? r.locationStatus}</Td>
                <Td>
                  {r.correctionReason ? (
                    <Badge tone="warning">Corrected</Badge>
                  ) : r.exception ? (
                    <Badge tone={r.reviewStatus === "PENDING" ? "critical" : "neutral"}>
                      {r.reviewStatus === "PENDING" ? "Needs review" : "Reviewed"}
                    </Badge>
                  ) : (
                    <span className="text-mute">—</span>
                  )}
                </Td>
                {writable && (
                  <Td align="right">
                    <ActionDialog
                      trigger="Correct"
                      triggerSize="sm"
                      title={`Correct record — ${fmtDate(r.date)}`}
                      description="The original values stay in the audit log with your reason, name and timestamp."
                      action={correctAttendance}
                      submitLabel="Apply correction"
                    >
                      <input type="hidden" name="recordId" value={r.id} />
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor={`ci-${r.id}`}>Check-in (HH:MM)</Label>
                          <Input id={`ci-${r.id}`} name="checkIn" defaultValue={r.checkIn ? fmtTime(r.checkIn) : ""} placeholder="08:30" />
                        </div>
                        <div>
                          <Label htmlFor={`co-${r.id}`}>Check-out (HH:MM)</Label>
                          <Input id={`co-${r.id}`} name="checkOut" defaultValue={r.checkOut ? fmtTime(r.checkOut) : ""} placeholder="17:00" />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`cs-${r.id}`}>Or mark day as</Label>
                        <Select id={`cs-${r.id}`} name="status" defaultValue="">
                          <option value="">— Derived from times —</option>
                          <option value="ABSENT">Absent</option>
                          <option value="LEAVE">On leave</option>
                          <option value="HOLIDAY">Holiday</option>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={`cr-${r.id}`} required>Correction reason</Label>
                        <Textarea id={`cr-${r.id}`} name="reason" required placeholder="Why is this record being corrected?" />
                      </div>
                    </ActionDialog>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}

async function Agreements({ employee, writable, evidenceMasked }: { employee: EmployeeFull; writable: boolean; evidenceMasked: boolean }) {
  const agreements = await db.agreement.findMany({
    where: { employeeId: employee.id },
    orderBy: [{ title: "asc" }, { version: "desc" }],
  });

  return (
    <Card>
      <CardHeader
        title="Employment agreements"
        subtitle="Versioned terms with acceptance evidence — superseded versions stay on record"
        actions={
          writable ? (
            <ActionDialog
              trigger={<><FileSignature size={12} /> Issue agreement</>}
              triggerSize="sm"
              triggerVariant="primary"
              title={`Issue agreement — ${employee.firstName} ${employee.lastName}`}
              description="Issues a new version. The employee then reviews and acceptance is recorded with evidence."
              action={issueAgreement}
              submitLabel="Issue"
              wide
            >
              <input type="hidden" name="employeeId" value={employee.id} />
              <div>
                <Label htmlFor="ag-title" required>Title</Label>
                <Input id="ag-title" name="title" defaultValue="Employment Agreement" required />
              </div>
              <div>
                <Label htmlFor="ag-comp">Compensation summary</Label>
                <Input id="ag-comp" name="compensationSummary" placeholder="Role-controlled summary shown on the agreement" />
              </div>
              <div>
                <Label htmlFor="ag-body" required>Terms</Label>
                <Textarea id="ag-body" name="body" required className="min-h-[160px]" placeholder="Full agreement terms…" />
                <Hint>The exact text is version-locked and hashed on acceptance.</Hint>
              </div>
            </ActionDialog>
          ) : undefined
        }
      />
      <CardBody className="space-y-3">
        {agreements.length === 0 && (
          <p className="py-6 text-center text-[13px] text-mute">
            No agreements issued yet. Legal accountability requires an accepted employment agreement.
          </p>
        )}
        {agreements.map((a) => (
          <details key={a.id} className="group rounded-lg border border-hairline">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
              <span className="font-medium text-ink">{a.title} <span className="font-mono text-[11px] text-mute">v{a.version}</span></span>
              <Badge tone={statusTone(a.status)} dot>{AGREEMENT_STATUS_LABELS[a.status as keyof typeof AGREEMENT_STATUS_LABELS]}</Badge>
              <span className="ml-auto text-[11.5px] text-mute">
                {a.acceptedAt ? `Accepted ${fmtDateTime(a.acceptedAt)}` : a.issuedAt ? `Issued ${fmtDateTime(a.issuedAt)}` : ""}
              </span>
            </summary>
            <div className="border-t border-hairline px-3.5 py-3">
              <DescriptionList
                columns={3}
                items={[
                  { label: "Issued", value: fmtDateTime(a.issuedAt) },
                  { label: "Accepted", value: fmtDateTime(a.acceptedAt) },
                  { label: "Compensation", value: a.compensationSummary ?? "—" },
                  { label: "OTP verified", value: evidence(a.otpVerified, evidenceMasked) },
                  { label: "Device recorded", value: evidence(a.deviceRecorded, evidenceMasked) },
                  { label: "Network recorded", value: evidence(a.networkRecorded, evidenceMasked) },
                  { label: "Location recorded", value: evidence(a.locationRecorded, evidenceMasked) },
                  { label: "Document hash", value: a.pdfHash ? <span className="font-mono text-[11px]">{evidenceMasked ? a.pdfHash.slice(0, 8) + "… (restricted)" : a.pdfHash.slice(0, 20) + "…"}</span> : "—" },
                  { label: "Acceptance statement", value: a.acceptanceStatement ? (evidenceMasked ? "Recorded (restricted)" : a.acceptanceStatement) : "—" },
                ]}
              />
              <div className="mt-3 rounded-md bg-canvas-soft p-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-mute">Version-locked terms</p>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-body">{a.body}</p>
              </div>
              {writable && a.status === "ISSUED" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionDialog
                    trigger="Record acceptance"
                    triggerVariant="primary"
                    triggerSize="sm"
                    title="Record acceptance evidence"
                    description="Records that the employee reviewed and accepted this exact version. Evidence flags become part of the legal record."
                    action={recordAcceptance}
                    submitLabel="Record acceptance"
                  >
                    <input type="hidden" name="agreementId" value={a.id} />
                    <div>
                      <Label htmlFor={`st-${a.id}`} required>Acceptance statement</Label>
                      <Textarea
                        id={`st-${a.id}`}
                        name="acceptanceStatement"
                        required
                        defaultValue={`I, ${employee.firstName} ${employee.lastName}, have read and accept the terms of ${a.title} version ${a.version}.`}
                      />
                    </div>
                    <fieldset className="space-y-2">
                      <legend className="text-[13px] font-medium text-ink">Evidence captured</legend>
                      {[
                        ["otpVerified", "OTP verification completed"],
                        ["deviceRecorded", "Device recorded"],
                        ["networkRecorded", "Network recorded"],
                        ["locationRecorded", "Location confirmation recorded"],
                      ].map(([nameKey, label]) => (
                        <label key={nameKey} className="flex items-center gap-2 text-[13px] text-body">
                          <input type="checkbox" name={nameKey} className="h-3.5 w-3.5 accent-[#171717]" />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </ActionDialog>
                  <ActionButton
                    label="Terminate"
                    variant="danger"
                    action={terminateAgreement}
                    confirmTitle="Terminate this agreement?"
                    confirmDescription="The version stays on record with a terminated status."
                    requireReason
                    hidden={{ agreementId: a.id }}
                  />
                </div>
              )}
            </div>
          </details>
        ))}
      </CardBody>
    </Card>
  );
}

function evidence(v: boolean, masked: boolean): React.ReactNode {
  if (masked) return "Restricted";
  return v ? <Badge tone="good">Yes</Badge> : <Badge tone="neutral">No</Badge>;
}

async function Policies({ employee, writable }: { employee: EmployeeFull; writable: boolean }) {
  const [active, acceptances] = await Promise.all([
    db.policy.findMany({ where: { status: "ACTIVE" }, orderBy: { title: "asc" } }),
    db.policyAcceptance.findMany({ where: { employeeId: employee.id } }),
  ]);
  const acceptedIds = new Map(acceptances.map((a) => [a.policyId, a]));

  return (
    <Card>
      <CardHeader title="Work policies" subtitle="Acceptance of each active policy version" />
      <TableShell className="rounded-t-none shadow-none">
        <THead>
          <Th>Policy</Th><Th>Category</Th><Th align="center">Version</Th><Th>Acceptance</Th>{writable && <Th align="right">Actions</Th>}
        </THead>
        <tbody>
          {active.length === 0 && (
            <TableEmpty colSpan={writable ? 5 : 4}>
              No active policies. Publish policies from the Policies module.
            </TableEmpty>
          )}
          {active.map((p) => {
            const acc = acceptedIds.get(p.id);
            return (
              <Tr key={p.id}>
                <Td>
                  <Link href={`/policies/${p.id}`} className="font-medium text-ink hover:underline">{p.title}</Link>
                </Td>
                <Td>{POLICY_CATEGORY_LABELS[p.category as keyof typeof POLICY_CATEGORY_LABELS] ?? p.category}</Td>
                <Td align="center" mono>v{p.version}</Td>
                <Td>
                  {acc ? (
                    <Badge tone="good">Accepted {fmtDate(acc.acceptedAt)}</Badge>
                  ) : (
                    <Badge tone="warning">Pending</Badge>
                  )}
                </Td>
                {writable && (
                  <Td align="right">
                    {!acc && (
                      <ActionDialog
                        trigger="Record acceptance"
                        triggerSize="sm"
                        title={`Policy acceptance — ${p.title} v${p.version}`}
                        action={recordPolicyAcceptance}
                        submitLabel="Record"
                      >
                        <input type="hidden" name="policyId" value={p.id} />
                        <input type="hidden" name="employeeId" value={employee.id} />
                        <label className="flex items-center gap-2 text-[13px] text-body">
                          <input type="checkbox" name="otpVerified" className="h-3.5 w-3.5 accent-[#171717]" />
                          OTP verification completed
                        </label>
                        <label className="flex items-center gap-2 text-[13px] text-body">
                          <input type="checkbox" name="deviceRecorded" className="h-3.5 w-3.5 accent-[#171717]" />
                          Device recorded
                        </label>
                      </ActionDialog>
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </TableShell>
    </Card>
  );
}

async function Expenses({ employeeId }: { employeeId: string }) {
  const expenses = await db.employeeExpense.findMany({
    where: { employeeId },
    orderBy: { expenseDate: "desc" },
    take: 20,
  });
  return (
    <Card>
      <CardHeader
        title="Expense claims"
        actions={<Link href="/finance/employee-expenses" className="text-[12px] font-medium text-link hover:underline">Open module</Link>}
      />
      <TableShell className="rounded-t-none shadow-none">
        <THead>
          <Th>Date</Th><Th>Category</Th><Th>Description</Th><Th align="right">Amount</Th><Th>Status</Th><Th>Flags</Th>
        </THead>
        <tbody>
          {expenses.length === 0 && <TableEmpty colSpan={6}>No expense claims recorded.</TableEmpty>}
          {expenses.map((e) => (
            <Tr key={e.id}>
              <Td>{fmtDate(e.expenseDate)}</Td>
              <Td>{e.category.replace(/_/g, " ").toLowerCase()}</Td>
              <Td className="max-w-56 truncate">{e.description}</Td>
              <Td align="right">{fmtIQD(e.amount)}</Td>
              <Td><Badge tone={statusTone(e.status)}>{e.status.toLowerCase()}</Badge></Td>
              <Td>
                {e.duplicateFlag && <Badge tone="warning">Possible duplicate</Badge>}
                {e.anomalyFlag && <Badge tone="critical" className="ml-1">Anomaly</Badge>}
                {!e.duplicateFlag && !e.anomalyFlag && <span className="text-mute">—</span>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  );
}

async function Payroll({ employeeId, salaryMasked }: { employeeId: string; salaryMasked: boolean }) {
  const items = await db.payrollItem.findMany({
    where: { employeeId },
    include: { payrollRun: { include: { branch: { select: { name: true } } } } },
    orderBy: { payrollRun: { period: "desc" } },
    take: 12,
  });
  if (salaryMasked) {
    return (
      <Card>
        <CardBody>
          <p className="py-8 text-center text-[13px] text-mute">
            Individual payroll detail is restricted for your role. Aggregate payroll is available in Finance → Payroll.
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Payroll history" />
      <TableShell className="rounded-t-none shadow-none">
        <THead>
          <Th>Period</Th><Th>Branch</Th><Th align="right">Base</Th><Th align="right">Overtime</Th>
          <Th align="right">Bonuses</Th><Th align="right">Deductions</Th><Th align="right">Net</Th><Th>Status</Th>
        </THead>
        <tbody>
          {items.length === 0 && <TableEmpty colSpan={8}>No payroll items yet. Payroll runs are created in Finance → Payroll.</TableEmpty>}
          {items.map((i) => (
            <Tr key={i.id}>
              <Td mono>{i.payrollRun.period}</Td>
              <Td>{i.payrollRun.branch.name}</Td>
              <Td align="right">{fmtIQD(i.baseSalary)}</Td>
              <Td align="right">{fmtIQD(i.overtimeAmount)}</Td>
              <Td align="right">{fmtIQD(i.bonuses)}</Td>
              <Td align="right">{fmtIQD(i.deductions + i.attendanceDeductions)}</Td>
              <Td align="right" className="font-medium text-ink">{fmtIQD(i.netAmount)}</Td>
              <Td><Badge tone={statusTone(i.payrollRun.status)}>{i.payrollRun.status.toLowerCase()}</Badge></Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  );
}

function Access({ employee }: { employee: EmployeeFull }) {
  return (
    <Card>
      <CardHeader title="System access" subtitle="Panel account linked to this employee" />
      <CardBody>
        {employee.user ? (
          <DescriptionList
            items={[
              { label: "Account email", value: employee.user.email },
              { label: "Role", value: employee.user.role.replace(/_/g, " ") },
              { label: "Status", value: employee.user.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="critical">Disabled</Badge> },
              { label: "MFA", value: employee.user.mfaEnabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="warning">Not enabled</Badge> },
              { label: "Last login", value: fmtDateTime(employee.user.lastLoginAt) },
            ]}
          />
        ) : (
          <p className="py-6 text-center text-[13px] text-mute">
            No system account linked. Accounts are managed in{" "}
            <Link href="/settings?tab=users" className="text-link hover:underline">Settings → Users</Link>.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

async function Audit({ employee }: { employee: EmployeeFull }) {
  const events = await db.auditEvent.findMany({
    where: {
      OR: [
        { resourceType: "Employee", resourceId: employee.id },
        { resourceType: "AttendanceRecord", resourceLabel: { contains: `${employee.firstName} ${employee.lastName}` } },
        { resourceType: "Agreement", resourceLabel: { contains: `${employee.firstName} ${employee.lastName}` } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return (
    <Card>
      <CardHeader title="Audit history" subtitle="Every recorded action affecting this employee" />
      <TableShell className="rounded-t-none shadow-none" dense>
        <THead>
          <Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Detail</Th><Th>Risk</Th>
        </THead>
        <tbody>
          {events.length === 0 && <TableEmpty colSpan={5}>No audit events recorded yet.</TableEmpty>}
          {events.map((e) => (
            <Tr key={e.id}>
              <Td className="whitespace-nowrap text-mute">{fmtDateTime(e.createdAt)}</Td>
              <Td>{e.userName}</Td>
              <Td mono>{e.action}</Td>
              <Td className="max-w-64 truncate">{e.reason ?? e.resourceLabel ?? "—"}</Td>
              <Td><Badge tone={e.riskLevel === "HIGH" ? "critical" : e.riskLevel === "MEDIUM" ? "warning" : "neutral"}>{e.riskLevel.toLowerCase()}</Badge></Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  );
}
