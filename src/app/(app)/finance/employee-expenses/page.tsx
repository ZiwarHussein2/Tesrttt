import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, maskingFor } from "@/lib/permissions";
import { fmtDate, fmtIQD, fmtIQDCompact, fmtNumber, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  EMPLOYEE_EXPENSE_CATEGORIES, EMPLOYEE_EXPENSE_CATEGORY_LABELS, EMPLOYEE_EXPENSE_STATUSES,
} from "@/types/enums";
import { createEmployeeExpense, reviewEmployeeExpense } from "../actions";

export const metadata: Metadata = { title: "Employee Expenses" };

const PAGE_SIZE = 25;

type Search = { q?: string; category?: string; status?: string; branch?: string; flag?: string; page?: string };

export default async function EmployeeExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("finance.employee-expenses");
  const scope = await getScope(user);
  const sp = await searchParams;
  const masking = maskingFor(user.role);
  const writable = canWrite(user.role, "finance.employee-expenses");

  const where = {
    branchId: { in: scope.branchIds },
    expenseDate: { gte: scope.from, lt: scope.to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.flag === "duplicate" ? { duplicateFlag: true } : {}),
    ...(sp.flag === "anomaly" ? { anomalyFlag: true } : {}),
    ...(sp.q
      ? {
          OR: [
            { description: { contains: sp.q } },
            { employee: { OR: [{ firstName: { contains: sp.q } }, { lastName: { contains: sp.q } }] } },
          ],
        }
      : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, claims, sums, pendingAgg, flaggedCount, branches, employees] = await Promise.all([
    db.employeeExpense.count({ where }),
    db.employeeExpense.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        branch: { select: { name: true } },
      },
      orderBy: { expenseDate: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.employeeExpense.aggregate({ where, _sum: { amount: true } }),
    db.employeeExpense.aggregate({
      where: { branchId: { in: scope.branchIds }, status: "SUBMITTED" },
      _sum: { amount: true }, _count: { id: true },
    }),
    db.employeeExpense.count({
      where: { branchId: { in: scope.branchIds }, OR: [{ duplicateFlag: true }, { anomalyFlag: true }], status: "SUBMITTED" },
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { branchId: { in: scope.branchIds }, employmentStatus: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, branch: { select: { name: true } } },
      orderBy: { firstName: "asc" },
    }),
  ]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/finance/employee-expenses?${params.toString()}`;
  };

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> New claim</>}
      triggerVariant="primary"
      title="Record employee expense claim"
      description="Duplicate and anomaly checks run automatically against the employee's history."
      action={createEmployeeExpense}
      submitLabel="Submit claim"
    >
      <div>
        <Label htmlFor="ec-emp" required>Employee</Label>
        <Select id="ec-emp" name="employeeId" required>
          {employees.length === 0 && <option value="">No active employees</option>}
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.branch.name}</option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ec-cat" required>Category</Label>
          <Select id="ec-cat" name="category" defaultValue="TRANSPORT">
            {EMPLOYEE_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EMPLOYEE_EXPENSE_CATEGORY_LABELS[c]}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="ec-amount" required>Amount (IQD)</Label>
          <Input id="ec-amount" name="amount" type="number" min={1} step="500" required />
        </div>
      </div>
      <div>
        <Label htmlFor="ec-desc" required>Description</Label>
        <Input id="ec-desc" name="description" required />
      </div>
      <div>
        <Label htmlFor="ec-date">Date</Label>
        <Input id="ec-date" name="expenseDate" type="date" />
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Employee Expenses"
        subtitle="Claims and reimbursements — travel, transport, meals, supplies, training, petty cash. Reimbursement posts a matching approved expense."
        actions={<>
          <ExportCsvButton filename="merna-employee-expenses.csv" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Claim value (period)" value={fmtIQDCompact(sums._sum.amount ?? 0)} />
        <KpiCard label="Claims (period)" value={fmtNumber(total)} />
        <KpiCard label="Awaiting review" value={fmtIQDCompact(pendingAgg._sum.amount ?? 0)} tone={(pendingAgg._count.id ?? 0) > 0 ? "warning" : undefined} definition={`${fmtNumber(pendingAgg._count.id)} submitted claims (all time).`} />
        <KpiCard label="Flagged pending" value={fmtNumber(flaggedCount)} tone={flaggedCount > 0 ? "warning" : undefined} definition="Pending claims with duplicate or anomaly indicators." />
      </div>

      {total === 0 && !sp.q && !sp.category && !sp.status && !sp.branch && !sp.flag ? (
        <EmptyState
          icon={<Wallet size={18} strokeWidth={1.5} />}
          title="No employee expense claims in this period"
          description="Record claims here or from an employee's Expenses tab."
          action={addDialog}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search employee, description…" className="w-full sm:w-60" />
            <FilterSelect param="category" label="Category" allLabel="All categories" options={EMPLOYEE_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EMPLOYEE_EXPENSE_CATEGORY_LABELS[c] }))} />
            <FilterSelect param="status" label="Status" allLabel="All statuses" options={EMPLOYEE_EXPENSE_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
            <FilterSelect param="flag" label="Flags" allLabel="All records" options={[
              { value: "duplicate", label: "Possible duplicates" },
              { value: "anomaly", label: "Anomalies" },
            ]} />
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                <Th>Date</Th><Th>Employee</Th><Th>Category</Th><Th>Description</Th>
                <Th align="right">Amount</Th><Th>Flags</Th><Th>Status</Th><Th>Reviewer</Th>
                {writable && <Th align="right">Review</Th>}
              </THead>
              <tbody>
                {claims.length === 0 && <TableEmpty colSpan={writable ? 9 : 8}>No claims match the current filters.</TableEmpty>}
                {claims.map((c) => (
                  <Tr key={c.id} highlight={(c.duplicateFlag || c.anomalyFlag) && c.status === "SUBMITTED"}>
                    <Td className="whitespace-nowrap">{fmtDate(c.expenseDate)}</Td>
                    <Td>
                      <Link href={`/employees/${c.employee.id}?tab=expenses`} className="font-medium text-ink hover:underline">
                        {masking.employeeContact ? maskName(c.employee.firstName, c.employee.lastName) : `${c.employee.firstName} ${c.employee.lastName}`}
                      </Link>
                      <span className="block text-[10.5px] text-mute">{c.branch.name}</span>
                    </Td>
                    <Td>{EMPLOYEE_EXPENSE_CATEGORY_LABELS[c.category as keyof typeof EMPLOYEE_EXPENSE_CATEGORY_LABELS] ?? c.category}</Td>
                    <Td className="max-w-52 truncate">{c.description}</Td>
                    <Td align="right" className="font-medium text-ink">{fmtIQD(c.amount)}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {c.duplicateFlag && <Badge tone="warning">Duplicate?</Badge>}
                        {c.anomalyFlag && <Badge tone="critical">Anomaly</Badge>}
                        {!c.duplicateFlag && !c.anomalyFlag && <span className="text-mute">—</span>}
                      </span>
                    </Td>
                    <Td><Badge tone={statusTone(c.status)} dot>{c.status.toLowerCase()}</Badge></Td>
                    <Td className="text-mute">{c.reviewedByName ?? "—"}</Td>
                    {writable && (
                      <Td align="right">
                        {(c.status === "SUBMITTED" || c.status === "APPROVED") && (
                          <ActionDialog
                            trigger={c.status === "SUBMITTED" ? "Review" : "Reimburse"}
                            triggerSize="sm"
                            title={`${c.status === "SUBMITTED" ? "Review" : "Reimburse"} claim — ${fmtIQD(c.amount)}`}
                            description={c.description}
                            action={reviewEmployeeExpense}
                            submitLabel="Apply"
                          >
                            <input type="hidden" name="claimId" value={c.id} />
                            <div>
                              <Label htmlFor={`ed-${c.id}`} required>Decision</Label>
                              <Select id={`ed-${c.id}`} name="decision" defaultValue={c.status === "SUBMITTED" ? "APPROVED" : "REIMBURSED"}>
                                {c.status === "SUBMITTED" && <option value="APPROVED">Approve</option>}
                                {c.status === "SUBMITTED" && <option value="REJECTED">Reject</option>}
                                {c.status === "APPROVED" && <option value="REIMBURSED">Mark reimbursed (posts expense)</option>}
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor={`er-${c.id}`}>Reason / note</Label>
                              <Textarea id={`er-${c.id}`} name="reason" placeholder="Required when rejecting" />
                            </div>
                          </ActionDialog>
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </div>
          <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
        </>
      )}
    </>
  );
}
