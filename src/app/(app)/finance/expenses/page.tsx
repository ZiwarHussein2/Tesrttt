import type { Metadata } from "next";
import { Plus, Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtDate, fmtIQD, fmtIQDCompact, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from "@/types/enums";
import { createExpense, reviewExpense } from "../actions";

export const metadata: Metadata = { title: "Expenses" };

const PAGE_SIZE = 25;

type Search = { q?: string; category?: string; status?: string; branch?: string; anomaly?: string; page?: string };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("finance.expenses");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "finance.expenses");

  const where = {
    branchId: { in: scope.branchIds },
    expenseDate: { gte: scope.from, lt: scope.to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.anomaly === "yes" ? { anomalyScore: { gte: 2 } } : {}),
    ...(sp.q ? { OR: [{ description: { contains: sp.q } }, { vendor: { contains: sp.q } }] } : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, expenses, approved, pending, branches, prevApproved, byVendor, weekendSum] = await Promise.all([
    db.expense.count({ where }),
    db.expense.findMany({
      where,
      include: { branch: { select: { name: true } }, department: { select: { name: true } } },
      orderBy: { expenseDate: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.expense.aggregate({
      where: { branchId: { in: scope.branchIds }, status: "APPROVED", expenseDate: { gte: scope.from, lt: scope.to } },
      _sum: { amount: true }, _count: { id: true },
    }),
    db.expense.aggregate({
      where: { branchId: { in: scope.branchIds }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      _sum: { amount: true }, _count: { id: true },
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.expense.aggregate({
      where: { branchId: { in: scope.branchIds }, status: "APPROVED", expenseDate: { gte: scope.prevFrom, lt: scope.prevTo } },
      _sum: { amount: true },
    }),
    db.expense.groupBy({
      by: ["vendor"],
      where: { branchId: { in: scope.branchIds }, status: "APPROVED", expenseDate: { gte: scope.from, lt: scope.to }, vendor: { not: null } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    db.expense.findMany({
      where: { branchId: { in: scope.branchIds }, expenseDate: { gte: scope.from, lt: scope.to } },
      select: { amount: true, expenseDate: true, anomalyScore: true },
    }),
  ]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/finance/expenses?${params.toString()}`;
  };

  const weekendTotal = weekendSum.filter((e) => [5, 6].includes(e.expenseDate.getDay())).reduce((s, e) => s + e.amount, 0);
  const anomalies = weekendSum.filter((e) => e.anomalyScore >= 2).length;
  const growth = (prevApproved._sum.amount ?? 0) > 0
    ? (((approved._sum.amount ?? 0) - (prevApproved._sum.amount ?? 0)) / (prevApproved._sum.amount ?? 1)) * 100
    : null;
  const topVendors = byVendor
    .map((v) => ({ vendor: v.vendor ?? "—", amount: v._sum.amount ?? 0, count: v._count.id }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const vendorTotal = byVendor.reduce((s, v) => s + (v._sum.amount ?? 0), 0);

  const departments = await db.department.findMany({
    where: { branchId: { in: scope.branchIds } },
    select: { id: true, name: true, branch: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Submit expense</>}
      triggerVariant="primary"
      title="Submit expense"
      description="Expenses count toward totals only after review approval. Anomaly scoring compares against category history."
      action={createExpense}
      submitLabel="Submit for review"
      wide
    >
      {!isBranchScoped(user.role) && (
        <div>
          <Label htmlFor="ex-branch" required>Branch</Label>
          <Select id="ex-branch" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ex-cat" required>Category</Label>
          <Select id="ex-cat" name="category" defaultValue="MAINTENANCE">
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="ex-dept">Department</Label>
          <Select id="ex-dept" name="departmentId" defaultValue="">
            <option value="">— Branch-level —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.branch.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="ex-desc" required>Description</Label>
        <Input id="ex-desc" name="description" placeholder="What was purchased or paid for" required />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="ex-amount" required>Amount (IQD)</Label>
          <Input id="ex-amount" name="amount" type="number" min={1} step="1000" required />
        </div>
        <div>
          <Label htmlFor="ex-date">Date</Label>
          <Input id="ex-date" name="expenseDate" type="date" />
        </div>
        <div>
          <Label htmlFor="ex-vendor">Vendor</Label>
          <Input id="ex-vendor" name="vendor" placeholder="Supplier" />
        </div>
        <div>
          <Label htmlFor="ex-method">Method</Label>
          <Select id="ex-method" name="paymentMethod" defaultValue="CASH">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="ex-notes">Notes</Label>
        <Input id="ex-notes" name="notes" placeholder="Optional" />
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Submission → review → approval workflow with anomaly scoring. Only approved expenses count in financial totals."
        actions={<>
          <ExportCsvButton filename="merna-expenses.csv" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Approved (period)" value={fmtIQDCompact(approved._sum.amount ?? 0)} definition={`${fmtNumber(approved._count.id)} approved expenses.`} />
        <KpiCard label="Pending review" value={fmtIQDCompact(pending._sum.amount ?? 0)} tone={(pending._count.id ?? 0) > 0 ? "warning" : undefined} definition={`${fmtNumber(pending._count.id)} awaiting decision (all time).`} />
        <KpiCard label="Growth vs prev period" value={growth !== null ? fmtPercent(growth) : "—"} invertDelta tone={growth !== null && growth > 15 ? "warning" : undefined} />
        <KpiCard label="Anomaly-flagged" value={fmtNumber(anomalies)} tone={anomalies > 0 ? "warning" : undefined} definition="Score ≥ 2: well above category average or weekend entries." />
      </div>

      {total === 0 && !sp.q && !sp.category && !sp.status && !sp.branch && !sp.anomaly ? (
        <EmptyState
          icon={<Receipt size={18} strokeWidth={1.5} />}
          title="No expenses in this period"
          description="Submit branch expenses for review. Salaries and overtime post automatically when payroll runs are paid."
          action={addDialog}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="xl:col-span-3">
            <Toolbar>
              <SearchInput placeholder="Search description, vendor…" className="w-full sm:w-60" />
              <FilterSelect param="category" label="Category" allLabel="All categories" options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))} />
              <FilterSelect param="status" label="Status" allLabel="All statuses" options={EXPENSE_STATUSES.map((s) => ({ value: s, label: EXPENSE_STATUS_LABELS[s] }))} />
              {branches.length > 1 && (
                <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              )}
              <FilterSelect param="anomaly" label="Anomalies" allLabel="All records" options={[{ value: "yes", label: "Anomalies only" }]} />
            </Toolbar>

            <div id="export-region">
              <TableShell dense>
                <THead>
                  <Th>Date</Th><Th>Description</Th><Th>Category</Th><Th>Branch</Th>
                  <Th>Submitted by</Th><Th align="right">Amount</Th><Th align="center">Anomaly</Th><Th>Status</Th>
                  {writable && <Th align="right">Review</Th>}
                </THead>
                <tbody>
                  {expenses.length === 0 && <TableEmpty colSpan={writable ? 9 : 8}>No expenses match the current filters.</TableEmpty>}
                  {expenses.map((e) => (
                    <Tr key={e.id} highlight={e.anomalyScore >= 2 && e.status !== "REJECTED"}>
                      <Td className="whitespace-nowrap">{fmtDate(e.expenseDate)}</Td>
                      <Td className="max-w-56">
                        <span className="block truncate font-medium text-ink">{e.description}</span>
                        <span className="text-[10.5px] text-mute">{e.vendor ?? ""}{e.department ? ` · ${e.department.name}` : ""}</span>
                      </Td>
                      <Td>{EXPENSE_CATEGORY_LABELS[e.category as keyof typeof EXPENSE_CATEGORY_LABELS] ?? e.category}</Td>
                      <Td>{e.branch.name}</Td>
                      <Td className="text-mute">{e.submittedByName}</Td>
                      <Td align="right" className="font-medium text-ink">{fmtIQD(e.amount)}</Td>
                      <Td align="center">
                        {e.anomalyScore >= 2 ? (
                          <Badge tone="warning">{e.anomalyScore.toFixed(1)}</Badge>
                        ) : (
                          <span className="text-mute">{e.anomalyScore > 0 ? e.anomalyScore.toFixed(1) : "—"}</span>
                        )}
                      </Td>
                      <Td><Badge tone={statusTone(e.status)} dot>{EXPENSE_STATUS_LABELS[e.status as keyof typeof EXPENSE_STATUS_LABELS]}</Badge></Td>
                      {writable && (
                        <Td align="right">
                          {(e.status === "SUBMITTED" || e.status === "UNDER_REVIEW") ? (
                            <ActionDialog
                              trigger="Review"
                              triggerSize="sm"
                              title={`Review expense — ${fmtIQD(e.amount)}`}
                              description={`${e.description} · submitted by ${e.submittedByName}${e.anomalyScore >= 2 ? ` · anomaly score ${e.anomalyScore.toFixed(1)}` : ""}`}
                              action={reviewExpense}
                              submitLabel="Apply decision"
                            >
                              <input type="hidden" name="expenseId" value={e.id} />
                              <div>
                                <Label htmlFor={`dec-${e.id}`} required>Decision</Label>
                                <Select id={`dec-${e.id}`} name="decision" defaultValue="APPROVED">
                                  <option value="APPROVED">Approve</option>
                                  <option value="UNDER_REVIEW">Mark under review</option>
                                  <option value="REJECTED">Reject</option>
                                </Select>
                              </div>
                              <div>
                                <Label htmlFor={`rr-${e.id}`}>Reason / note</Label>
                                <Textarea id={`rr-${e.id}`} name="reason" placeholder="Required when rejecting" />
                              </div>
                            </ActionDialog>
                          ) : (
                            <span className="text-[11px] text-mute">{e.reviewedByName ?? "—"}</span>
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
            <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
          </div>

          {/* Expense intelligence */}
          <div className="space-y-4">
            <Card>
              <CardHeader title="Vendor concentration" subtitle="Approved spend in period" />
              <CardBody>
                {topVendors.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-mute">No vendor data yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {topVendors.map((v) => (
                      <li key={v.vendor} className="flex items-baseline justify-between gap-2 border-t border-hairline pt-2 first:border-0 first:pt-0">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-ink">{v.vendor}</p>
                          <p className="text-[11px] text-mute">{v.count} expenses</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-medium tabular-nums text-ink">{fmtIQDCompact(v.amount)}</p>
                          <p className="text-[11px] text-mute">{vendorTotal > 0 ? fmtPercent((v.amount / vendorTotal) * 100, 0) : "—"}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Signals" subtitle="Neutral indicators — review, don't accuse" />
              <CardBody className="space-y-2.5 text-[12.5px]">
                <Signal label="Weekend-dated expenses" value={fmtIQDCompact(weekendTotal)} warn={weekendTotal > 0} />
                <Signal label="Anomaly-flagged entries" value={String(anomalies)} warn={anomalies > 0} />
                <Signal label="Pending review backlog" value={String(pending._count.id ?? 0)} warn={(pending._count.id ?? 0) > 5} />
                <Signal
                  label="Expense growth"
                  value={growth !== null ? fmtPercent(growth) : "no prior data"}
                  warn={growth !== null && growth > 15}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Signal({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
      <span className="text-body">{label}</span>
      <Badge tone={warn ? "warning" : "good"}>{value}</Badge>
    </div>
  );
}
