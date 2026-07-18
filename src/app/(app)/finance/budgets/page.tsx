import type { Metadata } from "next";
import { Plus, Target } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtIQD, fmtIQDCompact, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import { BulletBar } from "@/components/ui/viz";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/types/enums";
import { setBudget } from "../actions";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const user = await requireUser("finance.budgets");
  const scope = await getScope(user);
  const writable = canWrite(user.role, "finance.budgets");

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [budgets, branches] = await Promise.all([
    db.budget.findMany({
      where: { branchId: { in: scope.branchIds } },
      include: { branch: { select: { name: true } } },
      orderBy: [{ period: "desc" }, { branch: { name: "asc" } }],
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Actuals per (branch, period, category)
  const periods = [...new Set(budgets.map((b) => b.period))];
  const actuals = new Map<string, number>();
  for (const period of periods) {
    const [y, m] = period.split("-").map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 1);
    const grouped = await db.expense.groupBy({
      by: ["branchId", "category"],
      where: { branchId: { in: scope.branchIds }, status: "APPROVED", expenseDate: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    const totals = new Map<string, number>();
    for (const g of grouped) {
      actuals.set(`${g.branchId}|${period}|${g.category}`, g._sum.amount ?? 0);
      totals.set(g.branchId, (totals.get(g.branchId) ?? 0) + (g._sum.amount ?? 0));
    }
    for (const [branchId, sum] of totals) actuals.set(`${branchId}|${period}|`, sum);
  }

  const currentBudgets = budgets.filter((b) => b.period === currentPeriod);
  const currentBudgetTotal = currentBudgets.filter((b) => !b.category).reduce((s, b) => s + b.amount, 0);
  const currentActualTotal = currentBudgets
    .filter((b) => !b.category)
    .reduce((s, b) => s + (actuals.get(`${b.branchId}|${b.period}|`) ?? 0), 0);

  const setDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Set budget</>}
      triggerVariant="primary"
      title="Set budget"
      description="Total branch budget for a month, or a per-category limit. Setting the same scope again overwrites it (audited)."
      action={setBudget}
      submitLabel="Save budget"
    >
      {!isBranchScoped(user.role) && (
        <div>
          <Label htmlFor="bg-branch" required>Branch</Label>
          <Select id="bg-branch" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="bg-period" required>Period</Label>
          <Input id="bg-period" name="period" type="month" defaultValue={currentPeriod} required />
        </div>
        <div>
          <Label htmlFor="bg-amount" required>Amount (IQD)</Label>
          <Input id="bg-amount" name="amount" type="number" min={0} step="100000" required />
        </div>
      </div>
      <div>
        <Label htmlFor="bg-cat">Category</Label>
        <Select id="bg-cat" name="category" defaultValue="">
          <option value="">— Whole branch (total budget) —</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}
        </Select>
        <Hint>Leave empty for the branch&apos;s total monthly budget.</Hint>
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle="Monthly spending limits per branch and category, tracked against approved expenses."
        actions={<>
          <ExportCsvButton filename="merna-budgets.csv" />
          {setDialog}
        </>}
      />

      {budgets.length === 0 ? (
        <EmptyState
          icon={<Target size={18} strokeWidth={1.5} />}
          title="No budgets set"
          description="Set monthly budgets to track spending discipline. Budget overruns raise alerts and appear in AI briefings."
          action={setDialog}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Current month budget" value={fmtIQDCompact(currentBudgetTotal)} definition={`Sum of whole-branch budgets for ${currentPeriod}.`} />
            <KpiCard label="Current month actual" value={fmtIQDCompact(currentActualTotal)} />
            <KpiCard
              label="Utilization"
              value={currentBudgetTotal > 0 ? fmtPercent((currentActualTotal / currentBudgetTotal) * 100) : "—"}
              tone={currentBudgetTotal > 0 && currentActualTotal > currentBudgetTotal ? "critical" : undefined}
            />
            <KpiCard label="Budget lines" value={String(budgets.length)} />
          </div>

          {currentBudgets.filter((b) => !b.category).length > 0 && (
            <div className="mb-4 grid grid-cols-1 gap-4 rounded-lg bg-canvas p-4 shadow-card md:grid-cols-2">
              {currentBudgets.filter((b) => !b.category).map((b) => (
                <BulletBar
                  key={b.id}
                  label={`${b.branch.name} — ${b.period}`}
                  value={actuals.get(`${b.branchId}|${b.period}|`) ?? 0}
                  target={b.amount}
                  higherIsBetter={false}
                />
              ))}
            </div>
          )}

          <div id="export-region">
            <TableShell>
              <THead>
                <Th>Period</Th><Th>Branch</Th><Th>Scope</Th>
                <Th align="right">Budget</Th><Th align="right">Actual</Th><Th align="right">Variance</Th><Th>Status</Th>
              </THead>
              <tbody>
                {budgets.length === 0 && <TableEmpty colSpan={7}>No budgets defined.</TableEmpty>}
                {budgets.map((b) => {
                  const actual = actuals.get(`${b.branchId}|${b.period}|${b.category ?? ""}`) ?? 0;
                  const variance = b.amount > 0 ? ((actual - b.amount) / b.amount) * 100 : null;
                  const over = variance !== null && variance > 0;
                  return (
                    <Tr key={b.id} highlight={over}>
                      <Td mono>{b.period}</Td>
                      <Td>{b.branch.name}</Td>
                      <Td>{b.category ? EXPENSE_CATEGORY_LABELS[b.category as keyof typeof EXPENSE_CATEGORY_LABELS] ?? b.category : "Whole branch"}</Td>
                      <Td align="right">{fmtIQD(b.amount)}</Td>
                      <Td align="right">{fmtIQD(actual)}</Td>
                      <Td align="right" className={over ? "font-medium text-critical-deep" : "text-good-deep"}>
                        {variance !== null ? fmtPercent(variance) : "—"}
                      </Td>
                      <Td>
                        {over
                          ? <Badge tone="critical" dot>Over budget</Badge>
                          : actual / (b.amount || 1) > 0.85
                            ? <Badge tone="warning" dot>Approaching</Badge>
                            : <Badge tone="good" dot>Within budget</Badge>}
                      </Td>
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
