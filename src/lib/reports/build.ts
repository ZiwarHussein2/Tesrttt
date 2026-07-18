import "server-only";
import { db } from "@/lib/db";
import {
  attendanceStats, branchOverviews, complianceStats, financeSummary,
  inventoryStats, securityStats, visitStats,
} from "@/lib/analytics/metrics";
import { detectBottlenecks } from "@/lib/ai/bottlenecks";
import { fmtDuration, fmtIQD, fmtIQDCompact, fmtNumber, fmtPercent, maskName, fmtDate } from "@/lib/format";
import {
  DEPARTMENT_TYPE_LABELS, EXPENSE_CATEGORY_LABELS, REPORT_TYPE_LABELS, type ReportType,
} from "@/types/enums";
import type { ReportDocData, ReportSection } from "@/lib/reports/types";

export interface BuildParams {
  type: ReportType;
  title: string;
  branchIds: string[];
  scopeLabel: string;
  range: { from: Date; to: Date };
  prevRange: { from: Date; to: Date };
  preparedFor: string;
  confidentiality: string;
  companyName: string;
}

// Assembles a formal report from the same metric functions as the dashboards,
// so every figure in a generated PDF reconciles with the UI.
export async function buildReport(p: BuildParams): Promise<ReportDocData> {
  const sections: ReportSection[] = [];
  const periodLabel = `${p.range.from.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – ${p.range.to.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

  const add = (s: ReportSection) => sections.push(s);

  const wantsFinance = ["EXECUTIVE_SUMMARY", "BRANCH_PERFORMANCE", "CROSS_BRANCH", "FINANCIAL", "SHAREHOLDER_BOARD", "CUSTOM_AI"].includes(p.type);
  const wantsExpense = ["FINANCIAL", "EXPENSE", "EXECUTIVE_SUMMARY", "CUSTOM_AI"].includes(p.type);

  // ── Executive summary block ──
  if (wantsFinance || ["ATTENDANCE", "WORKFORCE", "RADIOLOGY_OPERATIONS"].includes(p.type)) {
    const [fin, prevFin, ops, att] = await Promise.all([
      financeSummary(p.branchIds, p.range),
      financeSummary(p.branchIds, p.prevRange),
      visitStats(p.branchIds, p.range),
      attendanceStats(p.branchIds, p.range),
    ]);
    const delta = prevFin.revenue > 0 ? ((fin.revenue - prevFin.revenue) / prevFin.revenue) * 100 : null;
    add({
      heading: "Executive summary",
      paragraphs: [
        `${p.scopeLabel} recorded revenue of ${fmtIQD(fin.revenue)}${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs the previous period)` : ""}, approved expenses of ${fmtIQD(fin.expenses)} and a net result of ${fmtIQD(fin.net)}${fin.margin !== null ? ` (${fmtPercent(fin.margin * 100)} margin)` : ""}. ${fmtNumber(ops.total)} patient visits were registered; attendance was ${att.rate !== null ? fmtPercent(att.rate) : "not measurable"}.`,
      ],
      kpis: [
        ["Total revenue", fmtIQD(fin.revenue)],
        ["Total expenses", fmtIQD(fin.expenses)],
        ["Net result", fmtIQD(fin.net)],
        ["Patient visits", fmtNumber(ops.total)],
        ["Attendance rate", att.rate !== null ? fmtPercent(att.rate) : "—"],
        ["Average wait", ops.avgWaitMinutes !== null ? fmtDuration(ops.avgWaitMinutes) : "—"],
        ["Report backlog", fmtNumber(ops.reportBacklog)],
        ["Discount value", fmtIQD(fin.discountValue)],
      ],
    });
  }

  // ── Branch performance ──
  if (["EXECUTIVE_SUMMARY", "BRANCH_PERFORMANCE", "CROSS_BRANCH", "SHAREHOLDER_BOARD"].includes(p.type)) {
    const rows = await branchOverviews(p.branchIds, p.range);
    add({
      heading: "Branch performance",
      table: {
        columns: ["Branch", "Health", "Revenue", "Expenses", "Net", "Visits", "Employees", "Attendance", "Avg wait", "Waste"],
        rows: rows.map((r) => [
          r.name,
          r.health.total !== null ? `${Math.round(r.health.total)}/100` : "—",
          fmtIQDCompact(r.revenue),
          fmtIQDCompact(r.expenses),
          fmtIQDCompact(r.net),
          fmtNumber(r.visits),
          fmtNumber(r.employees),
          r.attendanceRate !== null ? fmtPercent(r.attendanceRate) : "—",
          r.avgWait !== null ? fmtDuration(r.avgWait) : "—",
          r.wasteRate !== null ? fmtPercent(r.wasteRate) : "—",
        ]),
      },
    });
  }

  // ── Expense detail ──
  if (wantsExpense) {
    const fin = await financeSummary(p.branchIds, p.range);
    const catLabel = (c: string) => EXPENSE_CATEGORY_LABELS[c as keyof typeof EXPENSE_CATEGORY_LABELS] ?? c;
    add({
      heading: "Expense composition",
      table: {
        columns: ["Category", "Approved amount", "Share"],
        rows: fin.expensesByCategory.map((c) => [
          catLabel(c.category),
          fmtIQD(c.amount),
          fin.expenses > 0 ? fmtPercent((c.amount / fin.expenses) * 100) : "—",
        ]),
      },
      paragraphs: fin.pendingExpenses > 0 ? [`A further ${fmtIQD(fin.pendingExpenses)} is submitted and awaiting review (not included in totals).`] : [],
    });
  }

  if (p.type === "EMPLOYEE_EXPENSE") {
    const claims = await db.employeeExpense.findMany({
      where: { branchId: { in: p.branchIds }, expenseDate: { gte: p.range.from, lt: p.range.to } },
      include: { employee: { select: { firstName: true, lastName: true } }, branch: { select: { name: true } } },
      orderBy: { amount: "desc" },
      take: 40,
    });
    add({
      heading: "Employee expense claims",
      table: {
        columns: ["Employee", "Branch", "Category", "Amount", "Status", "Flags"],
        rows: claims.map((c) => [
          maskName(c.employee.firstName, c.employee.lastName),
          c.branch.name,
          c.category.replace(/_/g, " ").toLowerCase(),
          fmtIQD(c.amount),
          c.status.toLowerCase(),
          [c.duplicateFlag && "duplicate?", c.anomalyFlag && "anomaly"].filter(Boolean).join(", ") || "—",
        ]),
      },
    });
  }

  if (p.type === "PAYROLL") {
    const runs = await db.payrollRun.findMany({
      where: { branchId: { in: p.branchIds } },
      include: { branch: { select: { name: true } }, items: true },
      orderBy: { period: "desc" },
      take: 12,
    });
    add({
      heading: "Payroll runs",
      table: {
        columns: ["Period", "Branch", "Employees", "Base", "Overtime", "Deductions", "Net", "Status"],
        rows: runs.map((r) => {
          const base = r.items.reduce((s, i) => s + i.baseSalary, 0);
          const ot = r.items.reduce((s, i) => s + i.overtimeAmount, 0);
          const ded = r.items.reduce((s, i) => s + i.deductions + i.attendanceDeductions, 0);
          const net = r.items.reduce((s, i) => s + i.netAmount, 0);
          return [r.period, r.branch.name, r.items.length, fmtIQDCompact(base), fmtIQDCompact(ot), fmtIQDCompact(ded), fmtIQDCompact(net), r.status.toLowerCase()];
        }),
      },
    });
  }

  if (["ATTENDANCE", "WORKFORCE"].includes(p.type)) {
    const att = await attendanceStats(p.branchIds, p.range);
    add({
      heading: "Attendance & workforce",
      kpis: [
        ["Active employees", fmtNumber(att.activeEmployees)],
        ["Attendance rate", att.rate !== null ? fmtPercent(att.rate) : "—"],
        ["Present / Late / Absent", `${att.present} / ${att.late} / ${att.absent}`],
        ["Total lateness", fmtDuration(att.totalLateMinutes)],
        ["Total overtime", fmtDuration(att.totalOvertimeMinutes)],
        ["Exceptions", fmtNumber(att.exceptions)],
        ["Missing checkout", fmtNumber(att.missingCheckout)],
      ],
      paragraphs: ["Attendance = (present + late) ÷ scheduled working records; corrections retain the original values in the audit trail."],
    });
  }

  if (["INVENTORY", "WASTE_VARIANCE"].includes(p.type)) {
    const inv = await inventoryStats(p.branchIds, p.range);
    add({
      heading: "Inventory & waste",
      kpis: [
        ["Stock value", fmtIQD(inv.stockValue)],
        ["Items tracked", fmtNumber(inv.itemCount)],
        ["Low stock", fmtNumber(inv.lowStock)],
        ["Out of stock", fmtNumber(inv.outOfStock)],
        ["Consumption (period)", fmtIQD(inv.consumptionCost)],
        ["Waste cost (period)", fmtIQD(inv.wasteCost)],
        ["Waste rate", inv.wasteRate !== null ? fmtPercent(inv.wasteRate) : "—"],
        ["Manual corrections", fmtNumber(inv.correctionsCount)],
      ],
    });
    if (p.type === "WASTE_VARIANCE") {
      const waste = await db.inventoryMovement.findMany({
        where: { branchId: { in: p.branchIds }, type: "WASTED", occurredAt: { gte: p.range.from, lt: p.range.to } },
        include: { item: { select: { name: true, unit: true, unitCost: true } }, branch: { select: { name: true } } },
        orderBy: { occurredAt: "desc" },
        take: 40,
      });
      add({
        heading: "Waste entries",
        table: {
          columns: ["Date", "Item", "Branch", "Quantity", "Cost", "Reason", "Recorded by"],
          rows: waste.map((w) => [
            fmtDate(w.occurredAt), w.item.name, w.branch.name,
            `${Math.abs(w.quantity)} ${w.item.unit}`,
            fmtIQD(Math.abs(w.quantity) * w.item.unitCost),
            w.reason ?? "—", w.recordedByName,
          ]),
        },
      });
    }
  }

  if (["RADIOLOGY_OPERATIONS", "REPORT_TURNAROUND"].includes(p.type)) {
    const ops = await visitStats(p.branchIds, p.range);
    add({
      heading: "Radiology operations",
      kpis: [
        ["Visits", fmtNumber(ops.total)],
        ["Completed", fmtNumber(ops.completed)],
        ["Completion rate", ops.completionRate !== null ? fmtPercent(ops.completionRate * 100) : "—"],
        ["Cancelled", fmtNumber(ops.cancelled)],
        ["Average wait", ops.avgWaitMinutes !== null ? fmtDuration(ops.avgWaitMinutes) : "—"],
        ["Average test duration", ops.avgDurationMinutes !== null ? fmtDuration(ops.avgDurationMinutes) : "—"],
        ["Report backlog", fmtNumber(ops.reportBacklog)],
        ["Report turnaround", ops.avgReportTurnaroundHours !== null ? `${ops.avgReportTurnaroundHours.toFixed(1)}h` : "—"],
      ],
      table: {
        columns: ["Department type", "Visits"],
        rows: ops.byDepartmentType.map((d) => [DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type, d.count]),
      },
    });
  }

  if (p.type === "REFERRAL_DOCTORS") {
    const doctors = await db.referralDoctor.findMany({
      include: {
        referrals: { where: { branchId: { in: p.branchIds } }, include: { visit: { select: { paidAmount: true, registeredAt: true } } } },
        payments: { select: { amount: true } },
      },
    });
    add({
      heading: "Referral doctors",
      table: {
        columns: ["Doctor", "Deal", "Referrals (period)", "Attributed revenue", "Commission earned", "Paid", "Outstanding"],
        rows: doctors.map((d) => {
          const period = d.referrals.filter((r) => r.visit.registeredAt >= p.range.from && r.visit.registeredAt < p.range.to);
          const earned = d.referrals.filter((r) => !r.convertedToDiscount).reduce((s, r) => s + r.commissionAmount, 0);
          const paid = d.payments.reduce((s, x) => s + x.amount, 0);
          return [
            `Dr. ${d.name}`, d.dealType.replace(/_/g, " ").toLowerCase(), period.length,
            fmtIQDCompact(period.reduce((s, r) => s + r.visit.paidAmount, 0)),
            fmtIQDCompact(earned), fmtIQDCompact(paid), fmtIQDCompact(Math.max(0, earned - paid)),
          ];
        }),
      },
    });
  }

  if (p.type === "DISCOUNTS") {
    const requests = await db.discountRequest.findMany({
      where: { branchId: { in: p.branchIds }, createdAt: { gte: p.range.from, lt: p.range.to } },
      include: { branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    add({
      heading: "Discount activity",
      table: {
        columns: ["Date", "Branch", "Type", "Old price", "New price", "Value", "Status", "Requested by", "Reviewed by"],
        rows: requests.map((r) => [
          fmtDate(r.createdAt), r.branch.name, r.type.replace(/_/g, " ").toLowerCase(),
          fmtIQD(r.oldPrice), fmtIQD(r.newPrice), fmtIQD(r.oldPrice - r.newPrice),
          r.status.toLowerCase(), r.requestedByName, r.reviewedByName ?? "—",
        ]),
      },
    });
  }

  if (p.type === "MANAGEMENT_ACTIVITIES") {
    const events = await db.auditEvent.findMany({
      where: {
        riskLevel: { in: ["MEDIUM", "HIGH"] },
        OR: [{ branchId: null }, { branchId: { in: p.branchIds } }],
        createdAt: { gte: p.range.from, lt: p.range.to },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    add({
      heading: "Management activities",
      table: {
        columns: ["Time", "User", "Action", "Object", "Risk", "Reason"],
        rows: events.map((e) => [
          fmtDate(e.createdAt), e.userName, e.action, e.resourceLabel ?? e.resourceType, e.riskLevel.toLowerCase(), e.reason ?? "—",
        ]),
      },
    });
  }

  if (["LEGAL_ACCOUNTABILITY", "PRIVACY"].includes(p.type)) {
    const comp = await complianceStats(p.branchIds);
    add({
      heading: "Legal & compliance posture",
      kpis: [
        ["Active employees", fmtNumber(comp.activeEmployees)],
        ["Agreement completion", comp.agreementRate !== null ? fmtPercent(comp.agreementRate) : "—"],
        ["Policy acceptance", comp.policyAcceptanceRate !== null ? fmtPercent(comp.policyAcceptanceRate) : "—"],
        ["Active policies", fmtNumber(comp.activePolicies)],
        ["Pending reviews", fmtNumber(comp.pendingTotal)],
      ],
      paragraphs: [
        "Agreements are version-locked with acceptance evidence (OTP, device, network, location flags) and a SHA-256 content hash.",
        "The audit trail is append-only; corrections are recorded as new events with reasons.",
      ],
    });
  }

  if (p.type === "SECURITY") {
    const sec = await securityStats(p.branchIds);
    add({
      heading: "Security posture",
      kpis: [
        ["Active accounts", fmtNumber(sec.users)],
        ["MFA flag coverage", sec.mfaCoverage !== null ? fmtPercent(sec.mfaCoverage) : "—"],
        ["Active sessions", fmtNumber(sec.activeSessions)],
        ["Failed sign-ins (7d)", fmtNumber(sec.failedLogins7d)],
        ["Locked accounts", fmtNumber(sec.lockedUsers)],
        ["Open security incidents", fmtNumber(sec.openSecurityIncidents)],
        ["Open security alerts", fmtNumber(sec.openSecurityAlerts)],
      ],
    });
  }

  if (p.type === "SHAREHOLDER_BOARD") {
    const shareholders = await db.shareholder.findMany({ orderBy: { ownershipPercent: "desc" } });
    if (shareholders.length) {
      add({
        heading: "Ownership",
        table: {
          columns: ["Shareholder", "Ownership", "Voting"],
          rows: shareholders.map((s) => [s.name, fmtPercent(s.ownershipPercent, 1), fmtPercent(s.votingPercent ?? s.ownershipPercent, 1)]),
        },
        paragraphs: ["This report contains aggregate information approved for the ownership level only."],
      });
    }
  }

  // ── Findings & recommendations (bottleneck engine) ──
  if (["EXECUTIVE_SUMMARY", "BRANCH_PERFORMANCE", "CROSS_BRANCH", "RADIOLOGY_OPERATIONS", "CUSTOM_AI", "SHAREHOLDER_BOARD"].includes(p.type)) {
    const bottlenecks = await detectBottlenecks(p.branchIds, p.range, p.prevRange);
    add({
      heading: "Findings & risks",
      bullets: bottlenecks.length
        ? bottlenecks.slice(0, 8).map((b) => `[${b.severity}] ${b.branchName}${b.departmentName ? ` · ${b.departmentName}` : ""}: ${b.metric} ${b.value} (target ${b.target}). ${b.impact}`)
        : ["No active bottlenecks: all monitored rules are within their thresholds."],
    });
    if (bottlenecks.length) {
      add({
        heading: "Recommended actions",
        bullets: [...new Set(bottlenecks.slice(0, 8).map((b) => b.action))],
      });
    }
  }

  add({
    heading: "Data definitions",
    bullets: [
      "Revenue = income entries received in the period (patient services and other income).",
      "Expenses = approved expenses dated in the period; pending items are excluded and listed separately.",
      "Attendance = (present + late) ÷ scheduled working records, holidays excluded.",
      "Waste rate = waste cost ÷ (consumption + waste cost).",
      "Report turnaround = scan completion → report completion.",
      "All figures are produced by the same aggregation functions as the live dashboards.",
    ],
  });

  return {
    title: p.title,
    reportType: REPORT_TYPE_LABELS[p.type],
    scope: p.scopeLabel,
    period: periodLabel,
    preparedFor: p.preparedFor,
    confidentiality: p.confidentiality,
    sections,
    companyName: p.companyName,
  };
}
