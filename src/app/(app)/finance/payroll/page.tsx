import type { Metadata } from "next";
import { Banknote, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped, maskingFor } from "@/lib/permissions";
import { fmtIQD, fmtIQDCompact, fmtNumber, fmtPercent, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionButton, ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import { generatePayrollRun, setPayrollStatus } from "../actions";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const user = await requireUser("finance.payroll");
  const scope = await getScope(user);
  const sp = await searchParams;
  const masking = maskingFor(user.role);
  const writable = canWrite(user.role, "finance.payroll");

  const [runs, branches, incomeAgg] = await Promise.all([
    db.payrollRun.findMany({
      where: { branchId: { in: scope.branchIds } },
      include: {
        branch: { select: { name: true } },
        items: { select: { netAmount: true, baseSalary: true, overtimeAmount: true, attendanceDeductions: true, reimbursements: true, bonuses: true, deductions: true } },
      },
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.incomeEntry.aggregate({
      where: { branchId: { in: scope.branchIds }, receivedAt: { gte: scope.from, lt: scope.to } },
      _sum: { amount: true },
    }),
  ]);

  const selectedRun = sp.run
    ? await db.payrollRun.findUnique({
        where: { id: sp.run },
        include: {
          branch: { select: { name: true } },
          items: {
            include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, jobTitle: true } } },
            orderBy: { netAmount: "desc" },
          },
        },
      })
    : null;

  const defaultPeriod = new Date().toISOString().slice(0, 7);
  const paidRuns = runs.filter((r) => r.status === "PAID");
  const totalPaid = paidRuns.reduce((s, r) => s + r.items.reduce((x, i) => x + i.netAmount, 0), 0);
  const latestNet = runs[0]?.items.reduce((s, i) => s + i.netAmount, 0) ?? 0;
  const revenue = incomeAgg._sum.amount ?? 0;

  const generateDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Generate run</>}
      triggerVariant="primary"
      title="Generate payroll run"
      description="Creates a draft from base salaries, month overtime, absence deductions and approved employee-expense reimbursements."
      action={generatePayrollRun}
      submitLabel="Generate draft"
    >
      {!isBranchScoped(user.role) && (
        <div>
          <Label htmlFor="pr-branch" required>Branch</Label>
          <Select id="pr-branch" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      )}
      <div>
        <Label htmlFor="pr-period" required>Period</Label>
        <Input id="pr-period" name="period" type="month" defaultValue={defaultPeriod} required />
        <Hint>One run per branch per month. Marking a run paid posts salary and overtime expenses automatically.</Hint>
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Monthly payroll runs per branch: draft → approve → pay. Payment posts matching approved expenses so finance reconciles."
        actions={<>
          <ExportCsvButton filename="merna-payroll.csv" />
          {generateDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Runs on record" value={fmtNumber(runs.length)} />
        <KpiCard label="Latest run net" value={masking.employeeSalary ? "Restricted" : fmtIQDCompact(latestNet)} />
        <KpiCard label="Paid to date" value={masking.employeeSalary ? "Restricted" : fmtIQDCompact(totalPaid)} />
        <KpiCard
          label="Payroll % of revenue (period)"
          value={revenue > 0 && latestNet > 0 ? fmtPercent((latestNet / revenue) * 100) : "—"}
          definition="Latest run net ÷ income received in the selected period."
        />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={<Banknote size={18} strokeWidth={1.5} />}
          title="No payroll runs yet"
          description="Generate the first monthly run — it drafts from employee salaries, attendance and approved claims, then goes through approval before payment."
          action={generateDialog}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Payroll runs" subtitle="Select a run to inspect its items" />
            <TableShell className="rounded-t-none shadow-none">
              <THead>
                <Th>Period</Th><Th>Branch</Th><Th align="right">Employees</Th><Th align="right">Net total</Th><Th>Status</Th><Th align="right">Actions</Th>
              </THead>
              <tbody>
                {runs.map((r) => {
                  const net = r.items.reduce((s, i) => s + i.netAmount, 0);
                  return (
                    <Tr key={r.id} className={selectedRun?.id === r.id ? "bg-canvas-soft" : undefined}>
                      <Td mono>
                        <a href={`/finance/payroll?run=${r.id}`} className="font-medium text-ink hover:underline">{r.period}</a>
                      </Td>
                      <Td>{r.branch.name}</Td>
                      <Td align="right">{fmtNumber(r.items.length)}</Td>
                      <Td align="right" className="font-medium text-ink">
                        {masking.employeeSalary ? "•••" : fmtIQD(net)}
                      </Td>
                      <Td><Badge tone={statusTone(r.status)} dot>{r.status.toLowerCase()}</Badge></Td>
                      <Td align="right">
                        {writable && r.status === "DRAFT" && (
                          <ActionButton
                            label="Approve"
                            variant="primary"
                            action={setPayrollStatus}
                            confirmTitle={`Approve payroll ${r.period}?`}
                            confirmDescription="Approval locks the draft for payment."
                            hidden={{ runId: r.id, status: "APPROVED" }}
                          />
                        )}
                        {writable && r.status === "APPROVED" && (
                          <ActionButton
                            label="Mark paid"
                            variant="primary"
                            action={setPayrollStatus}
                            confirmTitle={`Mark payroll ${r.period} as paid?`}
                            confirmDescription="Posts the salary and overtime totals as approved expenses dated today."
                            hidden={{ runId: r.id, status: "PAID" }}
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </Card>

          <Card>
            <CardHeader
              title={selectedRun ? `Items — ${selectedRun.period} · ${selectedRun.branch.name}` : "Run items"}
              subtitle={selectedRun ? `Created by ${selectedRun.createdByName}${selectedRun.approvedByName ? ` · approved by ${selectedRun.approvedByName}` : ""}` : "Select a run on the left"}
            />
            {selectedRun ? (
              masking.employeeSalary ? (
                <p className="px-4 py-10 text-center text-[13px] text-mute">Individual payroll detail is restricted for your role.</p>
              ) : (
                <div id="export-region">
                  <TableShell className="rounded-t-none shadow-none" dense>
                    <THead>
                      <Th>Employee</Th><Th align="right">Base</Th><Th align="right">OT</Th>
                      <Th align="right">Deductions</Th><Th align="right">Reimb.</Th><Th align="right">Net</Th>
                    </THead>
                    <tbody>
                      {selectedRun.items.map((i) => (
                        <Tr key={i.id}>
                          <Td>
                            <a href={`/employees/${i.employee.id}?tab=payroll`} className="font-medium text-ink hover:underline">
                              {maskingFor(user.role).employeeContact ? maskName(i.employee.firstName, i.employee.lastName) : `${i.employee.firstName} ${i.employee.lastName}`}
                            </a>
                            <span className="block text-[10.5px] text-mute">{i.employee.jobTitle}</span>
                          </Td>
                          <Td align="right">{fmtIQD(i.baseSalary)}</Td>
                          <Td align="right">{fmtIQD(i.overtimeAmount)}</Td>
                          <Td align="right" className={i.attendanceDeductions + i.deductions > 0 ? "text-critical-deep" : undefined}>
                            {fmtIQD(i.attendanceDeductions + i.deductions)}
                          </Td>
                          <Td align="right">{fmtIQD(i.reimbursements)}</Td>
                          <Td align="right" className="font-semibold text-ink">{fmtIQD(i.netAmount)}</Td>
                        </Tr>
                      ))}
                      {selectedRun.items.length === 0 && <TableEmpty colSpan={6}>No items in this run.</TableEmpty>}
                    </tbody>
                  </TableShell>
                </div>
              )
            ) : (
              <p className="px-4 py-10 text-center text-[13px] text-mute">Select a payroll run to see the per-employee breakdown.</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
