import type { Metadata } from "next";
import Link from "next/link";
import { ChartPie } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { maskingFor } from "@/lib/permissions";
import {
  attendanceStats, financeSummary, revenueExpenseTrend, visitStats,
} from "@/lib/analytics/metrics";
import { fmtIQDCompact, fmtNumber, fmtPercent, pctChange } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TrendLines, CompareBars, Waterfall } from "@/components/ui/charts";
import { HBarList } from "@/components/ui/viz";
import { PrintButton } from "@/components/ui/export-button";
import { DEPARTMENT_TYPE_LABELS, EXPENSE_CATEGORY_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Financial Overview" };

export default async function FinancePage() {
  const user = await requireUser("finance");
  const scope = await getScope(user);
  const masking = maskingFor(user.role);
  const range = { from: scope.from, to: scope.to };
  const prevRange = { from: scope.prevFrom, to: scope.prevTo };

  const [fin, prevFin, ops, att, trend, branches, referralLiability, referralPaid, reportRates, reportPaid, deptRevenue, budgets] =
    await Promise.all([
      financeSummary(scope.branchIds, range),
      financeSummary(scope.branchIds, prevRange),
      visitStats(scope.branchIds, range),
      attendanceStats(scope.branchIds, range),
      revenueExpenseTrend(scope.branchIds, range),
      db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
      db.referral.aggregate({
        where: { branchId: { in: scope.branchIds }, convertedToDiscount: false },
        _sum: { commissionAmount: true },
      }),
      db.doctorPayment.aggregate({ where: { referralDoctorId: { not: null } }, _sum: { amount: true } }),
      db.visit.aggregate({
        where: { branchId: { in: scope.branchIds }, reportCompletedAt: { not: null }, reportRate: { not: null } },
        _sum: { reportRate: true },
      }),
      db.doctorPayment.aggregate({ where: { reportDoctorId: { not: null } }, _sum: { amount: true } }),
      db.incomeEntry.groupBy({
        by: ["departmentId"],
        where: { branchId: { in: scope.branchIds }, receivedAt: { gte: scope.from, lt: scope.to } },
        _sum: { amount: true },
      }),
      db.budget.findMany({
        where: { branchId: { in: scope.branchIds }, category: null },
      }),
    ]);

  const hasData = fin.revenue > 0 || fin.expenses > 0 || fin.pendingExpenses > 0;

  // Per-branch net
  const branchFinance = await Promise.all(
    branches.map(async (b) => ({ branch: b, fin: await financeSummary([b.id], range) })),
  );

  // Department revenue labels
  const departments = await db.department.findMany({
    where: { id: { in: deptRevenue.map((d) => d.departmentId).filter((x): x is string => !!x) } },
    select: { id: true, name: true, type: true, branch: { select: { code: true } } },
  });
  const deptMap = new Map(departments.map((d) => [d.id, d]));

  const costPerPatient = ops.total > 0 ? fin.expenses / ops.total : null;
  const revenuePerEmployee = att.activeEmployees > 0 ? fin.revenue / att.activeEmployees : null;
  const referralOutstanding = (referralLiability._sum.commissionAmount ?? 0) - (referralPaid._sum.amount ?? 0);
  const reportOutstanding = (reportRates._sum.reportRate ?? 0) - (reportPaid._sum.amount ?? 0);

  // Budget variance for the current month
  const currentPeriod = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const monthBudget = budgets.filter((b) => b.period === currentPeriod).reduce((s, b) => s + b.amount, 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthExpenses = await db.expense.aggregate({
    where: { branchId: { in: scope.branchIds }, status: "APPROVED", expenseDate: { gte: monthStart } },
    _sum: { amount: true },
  });
  const budgetVariance = monthBudget > 0 ? ((monthExpenses._sum.amount ?? 0) - monthBudget) / monthBudget * 100 : null;

  return (
    <>
      <PageHeader
        title="Financial Overview"
        subtitle="Group finance in the selected scope and period. All figures reconcile with module pages, Merna AI and generated reports."
        actions={<PrintButton />}
      />

      {!hasData ? (
        <EmptyState
          icon={<ChartPie size={18} strokeWidth={1.5} />}
          title="No financial activity yet"
          description="Revenue appears when patient payments and income entries are recorded; expenses appear when submitted and approved."
          action={
            <span className="flex gap-4">
              <Link href="/finance/income" className="text-[13px] font-medium text-link hover:underline">Record income</Link>
              <Link href="/finance/expenses" className="text-[13px] font-medium text-link hover:underline">Submit expense</Link>
            </span>
          }
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Total revenue" value={fmtIQDCompact(fin.revenue)} delta={pctChange(fin.revenue, prevFin.revenue)} definition="All income entries received in period." />
            <KpiCard label="Total expenses" value={fmtIQDCompact(fin.expenses)} delta={pctChange(fin.expenses, prevFin.expenses)} invertDelta definition="Approved expenses dated in period." />
            <KpiCard label="Net result" value={fmtIQDCompact(fin.net)} delta={pctChange(fin.net, prevFin.net)} tone={fin.net < 0 ? "critical" : undefined} />
            <KpiCard label="Operating margin" value={fin.margin !== null ? fmtPercent(fin.margin * 100) : "—"} />
            <KpiCard label="Payroll expense" value={fmtIQDCompact(fin.payrollExpense)} />
            <KpiCard label="Reimbursements" value={fmtIQDCompact(fin.reimbursements)} />
            <KpiCard label="Referral liability" value={masking.financeDetail ? "Restricted" : fmtIQDCompact(Math.max(0, referralOutstanding))} definition="Referral commissions earned minus payments made (all time)." />
            <KpiCard label="Report-doctor liability" value={masking.financeDetail ? "Restricted" : fmtIQDCompact(Math.max(0, reportOutstanding))} definition="Report fees earned minus payments made (all time)." />
            <KpiCard label="Waste cost" value={fmtIQDCompact(fin.wasteCost)} tone={fin.wasteCost > 0 ? "warning" : undefined} />
            <KpiCard label="Discount value" value={fmtIQDCompact(fin.discountValue)} />
            <KpiCard label="Cost per patient" value={costPerPatient !== null ? fmtIQDCompact(costPerPatient) : "—"} definition="Approved expenses ÷ visits in period." />
            <KpiCard
              label="Budget variance (month)"
              value={budgetVariance !== null ? fmtPercent(budgetVariance) : "—"}
              tone={budgetVariance !== null && budgetVariance > 0 ? "warning" : undefined}
              definition={monthBudget > 0 ? `Actual vs total budget of ${fmtIQDCompact(monthBudget)} for ${currentPeriod}.` : "Set budgets in Finance → Budgets."}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Revenue vs expenses" subtitle="Daily buckets across the period" />
              <CardBody>
                <TrendLines
                  data={trend}
                  money
                  series={[
                    { key: "revenue", label: "Revenue", color: "#171717" },
                    { key: "expenses", label: "Expenses", color: "#a1a1a1" },
                    { key: "net", label: "Net", color: "#0070f3" },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Revenue to net result" subtitle="Waterfall: where the money goes" />
              <CardBody>
                <Waterfall
                  data={[
                    { label: "Revenue", base: 0, value: fin.revenue, color: "#171717" },
                    { label: "Payroll", base: fin.revenue - fin.payrollExpense, value: fin.payrollExpense, color: "#a1a1a1" },
                    { label: "Other expenses", base: fin.net, value: Math.max(0, fin.expenses - fin.payrollExpense), color: "#c9c9c9" },
                    { label: "Net", base: 0, value: Math.max(0, fin.net), color: fin.net >= 0 ? "#0070f3" : "#ee0000" },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Net result by branch" />
              <CardBody>
                <CompareBars
                  money
                  data={branchFinance.map((b) => ({
                    label: b.branch.code,
                    revenue: b.fin.revenue,
                    expenses: b.fin.expenses,
                    net: b.fin.net,
                  }))}
                  series={[
                    { key: "revenue", label: "Revenue", color: "#171717" },
                    { key: "expenses", label: "Expenses", color: "#a1a1a1" },
                    { key: "net", label: "Net", color: "#0070f3" },
                  ]}
                />
              </CardBody>
            </Card>

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
              <CardHeader title="Revenue by department" subtitle="Income entries linked to departments" />
              <CardBody>
                {deptRevenue.length ? (
                  <HBarList
                    money
                    items={deptRevenue
                      .filter((d) => d.departmentId)
                      .sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))
                      .slice(0, 10)
                      .map((d) => {
                        const dep = deptMap.get(d.departmentId!);
                        return {
                          label: dep ? `${DEPARTMENT_TYPE_LABELS[dep.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? dep.name} · ${dep.branch.code}` : "Unassigned",
                          value: d._sum.amount ?? 0,
                        };
                      })}
                  />
                ) : (
                  <p className="py-8 text-center text-[13px] text-mute">No department-linked income yet.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Efficiency" subtitle="Cost and productivity ratios" />
              <CardBody className="space-y-3">
                <Ratio label="Cost per patient" value={costPerPatient !== null ? fmtIQDCompact(costPerPatient) : "—"} note="Approved expenses ÷ visits" />
                <Ratio label="Revenue per employee" value={revenuePerEmployee !== null ? fmtIQDCompact(revenuePerEmployee) : "—"} note="Revenue ÷ active employees" />
                <Ratio label="Payroll % of revenue" value={fin.revenue > 0 ? fmtPercent((fin.payrollExpense / fin.revenue) * 100) : "—"} note="Payroll expense ÷ revenue" />
                <Ratio label="Pending expense value" value={fmtIQDCompact(fin.pendingExpenses)} note="Awaiting review — not yet counted in expenses" />
              </CardBody>
            </Card>
          </div>

          <p className="mt-4 text-[12px] text-mute">
            Detail pages: <Link className="text-link hover:underline" href="/finance/income">Income</Link> ·{" "}
            <Link className="text-link hover:underline" href="/finance/expenses">Expenses</Link> ·{" "}
            <Link className="text-link hover:underline" href="/finance/employee-expenses">Employee Expenses</Link> ·{" "}
            <Link className="text-link hover:underline" href="/finance/payroll">Payroll</Link> ·{" "}
            <Link className="text-link hover:underline" href="/finance/budgets">Budgets</Link> ·{" "}
            <Link className="text-link hover:underline" href="/finance/discounts">Discounts</Link> ·{" "}
            <Link className="text-link hover:underline" href="/reports">Financial reports</Link>
          </p>
        </>
      )}
    </>
  );
}

function Ratio({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3 first:border-0 first:pt-0">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[11.5px] text-mute">{note}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
