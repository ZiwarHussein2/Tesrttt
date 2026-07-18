import "server-only";
import { db } from "@/lib/db";
import {
  attendanceStats, branchOverviews, complianceStats, financeSummary,
  inventoryStats, securityStats, visitStats,
} from "@/lib/analytics/metrics";
import { detectBottlenecks } from "@/lib/ai/bottlenecks";
import { maskingFor } from "@/lib/permissions";
import { fmtIQDCompact, fmtDuration, fmtPercent, fmtNumber } from "@/lib/format";
import { EXPENSE_CATEGORY_LABELS } from "@/types/enums";
import type { MernaAIAnswer, MernaAIProvider, MernaAIRequest } from "@/lib/ai/provider";

// Deterministic local intelligence: transparent rules over the same metric
// functions the dashboards use, so every figure reconciles across surfaces.
export class LocalMernaAIProvider implements MernaAIProvider {
  async answer(req: MernaAIRequest): Promise<MernaAIAnswer> {
    const q = req.question.toLowerCase();
    const scopeLabel = req.branchName ?? "All branches";
    const periodLabel = `${req.range.from.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${req.range.to.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

    const base = { scope: scopeLabel, period: periodLabel };

    const has = (...words: string[]) => words.some((w) => q.includes(w));

    if (has("bottleneck", "queue", "longest", "waiting time", "wait time")) return this.bottlenecks(req, base);
    if (has("compare", "difference", "different")) return this.compare(req, base);
    if (has("attention", "worst", "weakest", "problem branch")) return this.attention(req, base);
    if (has("expense", "spending", "cost growth", "costs grew")) return this.expenses(req, base);
    if (has("attendance", "late", "absent", "lateness")) return this.attendance(req, base);
    if (has("waste", "variance", "inventory", "stock")) return this.waste(req, base);
    if (has("management activity", "unusual", "corrections", "audit")) return this.management(req, base);
    if (has("report delay", "report backlog", "turnaround", "reports")) return this.reports(req, base);
    if (has("revenue", "income", "decrease", "decreased", "why", "profit")) return this.revenue(req, base);
    if (has("shareholder", "board")) return this.shareholder(req, base);
    if (has("legal", "agreement", "accountability", "policy")) return this.legal(req, base);
    if (has("security", "login", "access")) return this.security(req, base);
    if (has("changed", "since last week", "what's new", "change")) return this.changes(req, base);
    if (has("meeting", "discuss", "tomorrow", "action list", "actions")) return this.meetingBrief(req, base);
    return this.briefing(req, base);
  }

  // ── Executive briefing (default) ──
  private async briefing(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const [fin, prevFin, ops, att, rows, bottlenecks, criticalAlerts] = await Promise.all([
      financeSummary(req.branchIds, req.range),
      financeSummary(req.branchIds, req.prevRange),
      visitStats(req.branchIds, req.range),
      attendanceStats(req.branchIds, req.range),
      branchOverviews(req.branchIds, req.range),
      detectBottlenecks(req.branchIds, req.range, req.prevRange),
      db.alert.count({ where: { severity: "CRITICAL", status: { not: "RESOLVED" }, OR: [{ branchId: null }, { branchId: { in: req.branchIds } }] } }),
    ]);

    if (fin.revenue === 0 && ops.total === 0 && att.records === 0) {
      return {
        ...base,
        direct: "There is not enough operational data in this period to build a briefing yet. The system has no recorded visits, income or attendance for the selected scope.",
        findings: ["No visits, income entries or attendance records exist in the selected period."],
        evidence: [],
        calculations: [],
        risks: ["Decisions made without recorded data cannot be evidenced later."],
        actions: [
          "Create branches, departments and services if not done yet.",
          "Start recording operations: register visits, record payments and attendance.",
        ],
        confidence: "HIGH",
        sources: ["Income entries", "Visits", "Attendance records"],
        link: { href: "/branches", label: "Open branches" },
      };
    }

    const weakest = rows.filter((r) => r.health.total !== null).sort((a, b) => (a.health.total ?? 0) - (b.health.total ?? 0))[0];
    const revDelta = prevFin.revenue > 0 ? ((fin.revenue - prevFin.revenue) / prevFin.revenue) * 100 : null;

    return {
      ...base,
      direct: `${base.scope}: revenue ${fmtIQDCompact(fin.revenue)}${revDelta !== null ? ` (${revDelta >= 0 ? "+" : ""}${revDelta.toFixed(1)}% vs previous period)` : ""}, net result ${fmtIQDCompact(fin.net)}, ${fmtNumber(ops.total)} patient visits, attendance ${att.rate !== null ? fmtPercent(att.rate) : "n/a"}. ${bottlenecks.length === 0 ? "No active bottlenecks detected." : `${bottlenecks.length} bottleneck(s) need attention — the top one is ${bottlenecks[0].metric.toLowerCase()} at ${bottlenecks[0].branchName}${bottlenecks[0].departmentName ? ` (${bottlenecks[0].departmentName})` : ""}.`}`,
      findings: [
        `Operating margin: ${fin.margin !== null ? fmtPercent(fin.margin * 100) : "n/a (no revenue)"}.`,
        `Report backlog: ${ops.reportBacklog} (${ops.reportOverdue} overdue >24h).`,
        weakest ? `Weakest branch by health score: ${weakest.name} at ${Math.round(weakest.health.total ?? 0)}/100.` : "No branch health data yet.",
        `${criticalAlerts} unresolved critical alert(s).`,
        ...bottlenecks.slice(0, 3).map((bn) => `${bn.severity === "CRITICAL" ? "Critical" : "Warning"}: ${bn.metric} ${bn.value} (target ${bn.target}) — ${bn.branchName}${bn.departmentName ? `, ${bn.departmentName}` : ""}.`),
      ],
      evidence: [
        { label: "Revenue", value: fmtIQDCompact(fin.revenue), sublabel: "income received" },
        { label: "Expenses", value: fmtIQDCompact(fin.expenses), sublabel: "approved" },
        { label: "Net result", value: fmtIQDCompact(fin.net) },
        { label: "Visits", value: fmtNumber(ops.total) },
        { label: "Attendance", value: att.rate !== null ? fmtPercent(att.rate) : "—" },
        { label: "Avg wait", value: ops.avgWaitMinutes !== null ? fmtDuration(ops.avgWaitMinutes) : "—" },
      ],
      calculations: [
        "Revenue = Σ income entries received in period.",
        "Expenses = Σ approved expenses dated in period.",
        "Attendance = (present + late) ÷ scheduled working records.",
        "Health score = weighted: finance 25%, operations 25%, workforce 15%, inventory 15%, compliance 10%, security 10%.",
      ],
      risks: bottlenecks.slice(0, 3).map((bn) => bn.impact),
      actions: bottlenecks.slice(0, 4).map((bn) => bn.action),
      confidence: "HIGH",
      sources: ["Income entries", "Expenses", "Visits", "Attendance", "Alerts", "Bottleneck engine"],
      link: { href: "/dashboard", label: "Open executive dashboard" },
    };
  }

  // ── Bottlenecks ──
  private async bottlenecks(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const bottlenecks = await detectBottlenecks(req.branchIds, req.range, req.prevRange);
    if (bottlenecks.length === 0) {
      return {
        ...base,
        direct: "No bottlenecks detected in the current scope. All queues, machines, reports, inventory, staffing and reviews are within their targets.",
        findings: ["Every monitored rule (queue, machine, report, inventory, expense, attendance, management, security) is within threshold."],
        evidence: [],
        calculations: ["Rules compare live metrics against configured targets (department wait targets, capacity, ≤10 report backlog, ≥7 days cover, ≤5% waste, ≥85% attendance)."],
        risks: [],
        actions: ["No action required. Re-run after operational hours for a fresh picture."],
        confidence: "HIGH",
        sources: ["Bottleneck engine"],
        link: { href: "/live", label: "Open live operations" },
      };
    }
    const top = bottlenecks[0];
    return {
      ...base,
      direct: `${bottlenecks.length} bottleneck(s) detected. The most severe: ${top.metric} at ${top.value} against a target of ${top.target} — ${top.branchName}${top.departmentName ? `, ${top.departmentName}` : ""}. ${top.likelyCause}`,
      findings: bottlenecks.slice(0, 6).map((b) =>
        `[${b.severity}] ${b.category}: ${b.metric} = ${b.value} (target ${b.target}) — ${b.branchName}${b.departmentName ? `, ${b.departmentName}` : ""}.`,
      ),
      evidence: bottlenecks.slice(0, 6).map((b) => ({
        label: `${b.branchName}${b.departmentName ? ` · ${b.departmentName}` : ""}`,
        value: b.value,
        sublabel: b.metric,
      })),
      calculations: ["Each rule compares the live metric with its target; severity escalates at 2× the threshold overage."],
      risks: [...new Set(bottlenecks.slice(0, 4).map((b) => b.impact))],
      actions: [...new Set(bottlenecks.slice(0, 5).map((b) => b.action))],
      confidence: "HIGH",
      sources: ["Bottleneck engine", "Visits", "Machines", "Inventory", "Attendance"],
      link: { href: top.link, label: "Open the affected area" },
    };
  }

  // ── Branch needing attention ──
  private async attention(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const rows = await branchOverviews(req.branchIds, req.range);
    const scored = rows.filter((r) => r.health.total !== null).sort((a, b) => (a.health.total ?? 0) - (b.health.total ?? 0));
    if (scored.length === 0) {
      return this.insufficient(base, "No branch has enough recorded data to compute a health score yet.", "/branches", "Open branches");
    }
    const worst = scored[0];
    const weakComponent = worst.health.components.filter((c) => c.score !== null).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
    return {
      ...base,
      direct: `${worst.name} needs the most attention: health score ${Math.round(worst.health.total ?? 0)}/100, weakest component ${weakComponent?.label.toLowerCase() ?? "n/a"}${weakComponent ? ` at ${Math.round(weakComponent.score ?? 0)}/100` : ""}.`,
      findings: scored.map((r) => `${r.name}: health ${Math.round(r.health.total ?? 0)}/100 — net ${fmtIQDCompact(r.net)}, wait ${r.avgWait !== null ? fmtDuration(r.avgWait) : "n/a"}, backlog ${r.reportBacklog}, critical alerts ${r.criticalAlerts}.`),
      evidence: scored.slice(0, 4).map((r) => ({ label: r.name, value: `${Math.round(r.health.total ?? 0)}/100`, sublabel: "health score" })),
      calculations: worst.health.components.map((c) => `${c.label} (${c.weight}%): ${c.detail}`),
      risks: [worst.criticalAlerts > 0 ? `${worst.name} carries ${worst.criticalAlerts} unresolved critical alert(s).` : `${worst.name}'s weakest area is ${weakComponent?.label.toLowerCase() ?? "unknown"}.`],
      actions: [`Open ${worst.name}'s command center and review the ${weakComponent?.label.toLowerCase() ?? "weakest"} tab.`, "Ask for a bottleneck scan scoped to that branch."],
      confidence: "HIGH",
      sources: ["Branch health engine", "Alerts"],
      link: { href: `/branches/${worst.id}`, label: `Open ${worst.name}` },
    };
  }

  // ── Comparison ──
  private async compare(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const rows = await branchOverviews(req.branchIds, req.range);
    if (rows.length < 2) {
      return this.insufficient(base, "Comparison needs at least two branches in scope. Switch the branch scope to All Branches.", "/branches", "Open branches");
    }
    const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
    const byMargin = [...rows].sort((a, b) => (b.revenue ? b.net / b.revenue : -1) - (a.revenue ? a.net / a.revenue : -1));
    const byWait = [...rows].filter((r) => r.avgWait !== null).sort((a, b) => (a.avgWait ?? 0) - (b.avgWait ?? 0));
    return {
      ...base,
      direct: `${byRevenue[0].name} leads on revenue (${fmtIQDCompact(byRevenue[0].revenue)}); ${byMargin[0].name} has the best margin${byMargin[0].revenue > 0 ? ` (${fmtPercent((byMargin[0].net / byMargin[0].revenue) * 100)})` : ""}; ${byWait.length ? `${byWait[0].name} has the shortest waits (${fmtDuration(byWait[0].avgWait!)})` : "wait-time data is not yet comparable"}.`,
      findings: rows.map((r) =>
        `${r.name}: revenue ${fmtIQDCompact(r.revenue)}, net ${fmtIQDCompact(r.net)}, visits ${fmtNumber(r.visits)}, attendance ${r.attendanceRate !== null ? fmtPercent(r.attendanceRate) : "n/a"}, waste ${r.wasteRate !== null ? fmtPercent(r.wasteRate) : "n/a"}, health ${r.health.total !== null ? Math.round(r.health.total) : "n/a"}/100.`,
      ),
      evidence: rows.map((r) => ({ label: r.name, value: fmtIQDCompact(r.net), sublabel: "net result" })),
      calculations: ["All figures come from the same aggregation functions as the dashboards, so they reconcile exactly."],
      risks: rows.filter((r) => r.criticalAlerts > 0).map((r) => `${r.name} has ${r.criticalAlerts} unresolved critical alert(s).`),
      actions: ["Open the side-by-side comparison for the full metric matrix and charts."],
      confidence: "HIGH",
      sources: ["Branch overviews", "Health engine"],
      link: { href: `/branches/compare?${rows.slice(0, 3).map((r) => `ids=${r.id}`).join("&")}`, label: "Open full comparison" },
    };
  }

  // ── Expenses ──
  private async expenses(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const [fin, prevFin, anomalies, claims] = await Promise.all([
      financeSummary(req.branchIds, req.range),
      financeSummary(req.branchIds, req.prevRange),
      db.expense.findMany({
        where: { branchId: { in: req.branchIds }, anomalyScore: { gte: 2 }, expenseDate: { gte: req.range.from, lt: req.range.to } },
        orderBy: { anomalyScore: "desc" },
        take: 5,
      }),
      db.employeeExpense.count({
        where: { branchId: { in: req.branchIds }, OR: [{ duplicateFlag: true }, { anomalyFlag: true }], expenseDate: { gte: req.range.from, lt: req.range.to } },
      }),
    ]);
    if (fin.expenses === 0 && fin.pendingExpenses === 0) {
      return this.insufficient(base, "No expenses are recorded in this period, so there is nothing to analyze yet.", "/finance/expenses", "Open expenses");
    }
    const growth = prevFin.expenses > 0 ? ((fin.expenses - prevFin.expenses) / prevFin.expenses) * 100 : null;
    const catLabel = (c: string) => EXPENSE_CATEGORY_LABELS[c as keyof typeof EXPENSE_CATEGORY_LABELS] ?? c;
    return {
      ...base,
      direct: `Approved expenses are ${fmtIQDCompact(fin.expenses)}${growth !== null ? ` (${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% vs previous period)` : ""}. The largest categories are ${fin.expensesByCategory.slice(0, 3).map((c) => `${catLabel(c.category)} (${fmtIQDCompact(c.amount)})`).join(", ")}.`,
      findings: [
        `Pending review: ${fmtIQDCompact(fin.pendingExpenses)}.`,
        `Payroll share: ${fin.expenses > 0 ? fmtPercent((fin.payrollExpense / fin.expenses) * 100) : "n/a"} of approved expenses.`,
        `${anomalies.length} expense(s) carry an anomaly score ≥ 2 in this period.`,
        `${claims} employee claim(s) flagged as duplicates or anomalies.`,
      ],
      evidence: fin.expensesByCategory.slice(0, 6).map((c) => ({ label: catLabel(c.category), value: fmtIQDCompact(c.amount) })),
      calculations: [
        "Anomaly score = multiples above the category's historical average (+1 for weekend-dated entries).",
        "Only approved expenses count toward totals; pending items are shown separately.",
      ],
      risks: anomalies.slice(0, 3).map((a) => `Review: "${a.description}" — ${fmtIQDCompact(a.amount)}, anomaly score ${a.anomalyScore.toFixed(1)} (requires review, not an accusation).`),
      actions: ["Open expense intelligence to review anomalies and vendor concentration.", "Clear the pending review queue to keep totals accurate."],
      confidence: "HIGH",
      sources: ["Expenses", "Employee expenses"],
      link: { href: "/finance/expenses", label: "Open expenses" },
    };
  }

  // ── Attendance ──
  private async attendance(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const att = await attendanceStats(req.branchIds, req.range);
    if (att.records === 0) {
      return this.insufficient(base, "No attendance records exist in this period yet.", "/attendance", "Open attendance");
    }
    const lateEmployees = await db.attendanceRecord.groupBy({
      by: ["employeeId"],
      where: { branchId: { in: req.branchIds }, date: { gte: req.range.from, lt: req.range.to }, status: "LATE" },
      _count: { id: true },
      _sum: { lateMinutes: true },
    });
    const repeatOffenders = lateEmployees.filter((e) => e._count.id >= 3).length;
    return {
      ...base,
      direct: `Attendance is ${att.rate !== null ? fmtPercent(att.rate) : "n/a"} across ${att.records} records: ${att.late} late arrivals, ${att.absent} absences, ${fmtDuration(att.totalOvertimeMinutes)} of overtime. ${att.exceptions} record(s) carry exceptions and ${att.missingCheckout} are missing checkout.`,
      findings: [
        `${repeatOffenders} employee(s) were late three or more times in the period (requires review).`,
        `Total lateness: ${fmtDuration(att.totalLateMinutes)}.`,
        `Estimated payroll impact of absences is deducted automatically in payroll runs (1 day's base pay per absence).`,
      ],
      evidence: [
        { label: "Attendance rate", value: att.rate !== null ? fmtPercent(att.rate) : "—" },
        { label: "Late", value: String(att.late) },
        { label: "Absent", value: String(att.absent) },
        { label: "Overtime", value: fmtDuration(att.totalOvertimeMinutes) },
        { label: "Exceptions", value: String(att.exceptions) },
      ],
      calculations: ["Attendance = (present + late) ÷ scheduled working records; holidays excluded."],
      risks: att.rate !== null && att.rate < 85 ? ["Attendance below the 85% target creates staffing bottlenecks and queue pressure."] : [],
      actions: ["Review the exception queue in Attendance.", "Check lateness by department in Workforce Analytics."],
      confidence: "HIGH",
      sources: ["Attendance records"],
      link: { href: "/attendance", label: "Open attendance" },
    };
  }

  // ── Waste ──
  private async waste(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const inv = await inventoryStats(req.branchIds, req.range);
    if (inv.itemCount === 0) {
      return this.insufficient(base, "No inventory items are tracked yet, so waste analysis is not possible.", "/inventory", "Open inventory");
    }
    const wasteMovs = await db.inventoryMovement.findMany({
      where: { branchId: { in: req.branchIds }, type: "WASTED", occurredAt: { gte: req.range.from, lt: req.range.to } },
      include: { item: { select: { name: true, unitCost: true } } },
    });
    const byItem = new Map<string, number>();
    for (const m of wasteMovs) byItem.set(m.item.name, (byItem.get(m.item.name) ?? 0) + Math.abs(m.quantity) * m.item.unitCost);
    const topWaste = [...byItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      ...base,
      direct: `Waste in the period costs ${fmtIQDCompact(inv.wasteCost)} at a rate of ${inv.wasteRate !== null ? fmtPercent(inv.wasteRate) : "n/a"} of consumption. ${inv.correctionsCount} manual stock corrections were recorded.${topWaste.length ? ` The costliest wasted items: ${topWaste.map(([n, v]) => `${n} (${fmtIQDCompact(v)})`).join(", ")}.` : ""}`,
      findings: [
        `${inv.lowStock} item(s) low, ${inv.outOfStock} out of stock.`,
        `Stock value on hand: ${fmtIQDCompact(inv.stockValue)}.`,
        inv.wasteRate !== null && inv.wasteRate > 5
          ? "Waste rate exceeds the 5% threshold — the Waste & Variance page lists review signals (after-hours entries, unverified corrections, repeated user pairs)."
          : "Waste rate is within the 5% threshold.",
      ],
      evidence: [
        { label: "Waste cost", value: fmtIQDCompact(inv.wasteCost) },
        { label: "Waste rate", value: inv.wasteRate !== null ? fmtPercent(inv.wasteRate) : "—" },
        { label: "Corrections", value: String(inv.correctionsCount) },
        ...topWaste.map(([n, v]) => ({ label: n, value: fmtIQDCompact(v), sublabel: "wasted" })),
      ],
      calculations: ["Waste rate = waste cost ÷ (consumption + waste cost). Expected use comes from service recipes on completed scans."],
      risks: ["Patterns are neutral indicators that require review — they are not accusations against any person."],
      actions: ["Open Waste & Variance and review items above the 15% variance threshold.", "Verify corrections that lack a second-person verification."],
      confidence: "HIGH",
      sources: ["Inventory movements", "Service recipes"],
      link: { href: "/inventory/waste", label: "Open waste & variance" },
    };
  }

  // ── Management activity ──
  private async management(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const events = await db.auditEvent.findMany({
      where: {
        riskLevel: { in: ["MEDIUM", "HIGH"] },
        OR: [{ branchId: null }, { branchId: { in: req.branchIds } }],
        createdAt: { gte: req.range.from, lt: req.range.to },
      },
      orderBy: { createdAt: "desc" },
    });
    if (events.length === 0) {
      return this.insufficient(base, "No management activity has been recorded in this period.", "/management-activities", "Open management activities");
    }
    const afterHours = events.filter((e) => { const h = e.createdAt.getHours(); return h < 7 || h >= 22; });
    const priceChanges = events.filter((e) => e.action.includes("price"));
    const byUser = new Map<string, number>();
    for (const e of events) byUser.set(e.userName, (byUser.get(e.userName) ?? 0) + 1);
    const topUsers = [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      ...base,
      direct: `${events.length} medium/high-risk management actions in the period: ${events.filter((e) => e.riskLevel === "HIGH").length} high-impact, ${priceChanges.length} price change(s), ${afterHours.length} outside normal hours (07:00–22:00).`,
      findings: [
        `Most active: ${topUsers.map(([n, c]) => `${n} (${c})`).join(", ")}.`,
        ...(afterHours.length > 0 ? [`After-hours actions require review: ${afterHours.slice(0, 3).map((e) => `${e.action} by ${e.userName}`).join("; ")}.`] : []),
        ...(priceChanges.length > 0 ? [`Price changes recorded: ${priceChanges.slice(0, 3).map((e) => e.resourceLabel ?? e.action).join("; ")}.`] : []),
      ],
      evidence: [
        { label: "Total activities", value: String(events.length) },
        { label: "High-impact", value: String(events.filter((e) => e.riskLevel === "HIGH").length) },
        { label: "After-hours", value: String(afterHours.length) },
        { label: "Price changes", value: String(priceChanges.length) },
      ],
      calculations: ["Management activities = audit events with medium or high risk level."],
      risks: ["Concentrated or after-hours administrative activity is a neutral review signal, not evidence of wrongdoing."],
      actions: ["Open Management Activities for the full filtered list with old/new values and reasons."],
      confidence: "HIGH",
      sources: ["Audit trail"],
      link: { href: "/management-activities", label: "Open management activities" },
    };
  }

  // ── Reports ──
  private async reports(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const ops = await visitStats(req.branchIds, req.range);
    const unassigned = await db.visit.count({
      where: { branchId: { in: req.branchIds }, reportRequired: true, reportDoctorId: null, status: { in: ["SCAN_COMPLETED", "PRINTING_COMPLETED"] } },
    });
    if (ops.reportBacklog === 0 && ops.avgReportTurnaroundHours === null) {
      return this.insufficient(base, "No report workload exists in this period — no completed scans require reports yet.", "/operations/reports", "Open report workflow");
    }
    return {
      ...base,
      direct: `The report backlog is ${ops.reportBacklog} (${unassigned} unassigned, ${ops.reportOverdue} overdue >24h). Average turnaround in the period is ${ops.avgReportTurnaroundHours !== null ? `${ops.avgReportTurnaroundHours.toFixed(1)}h` : "not yet measurable"}.`,
      findings: [
        ops.reportBacklog > 10 ? "Backlog exceeds the 10-item threshold." : "Backlog is within threshold.",
        unassigned > 0 ? `${unassigned} completed scan(s) have no assigned reading doctor.` : "All backlog items are assigned.",
      ],
      evidence: [
        { label: "Backlog", value: String(ops.reportBacklog) },
        { label: "Unassigned", value: String(unassigned) },
        { label: "Overdue >24h", value: String(ops.reportOverdue) },
        { label: "Avg turnaround", value: ops.avgReportTurnaroundHours !== null ? `${ops.avgReportTurnaroundHours.toFixed(1)}h` : "—" },
      ],
      calculations: ["Turnaround = scan completion → report completion. Overdue = backlog older than 24h since scan completion."],
      risks: ops.reportOverdue > 0 ? ["Overdue reports delay patient results and completion rates."] : [],
      actions: ["Assign unassigned scans in the report workflow.", "Review per-doctor turnaround and workload distribution."],
      confidence: "HIGH",
      sources: ["Visits", "Report workflow"],
      link: { href: "/operations/reports", label: "Open report workflow" },
    };
  }

  // ── Revenue ──
  private async revenue(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const [fin, prevFin, ops, prevOps, machines] = await Promise.all([
      financeSummary(req.branchIds, req.range),
      financeSummary(req.branchIds, req.prevRange),
      visitStats(req.branchIds, req.range),
      visitStats(req.branchIds, req.prevRange),
      db.machine.findMany({
        where: { department: { branchId: { in: req.branchIds } }, status: { in: ["OFFLINE", "MAINTENANCE"] } },
        include: { department: { select: { name: true, branch: { select: { name: true } } } } },
      }),
    ]);
    if (fin.revenue === 0 && prevFin.revenue === 0) {
      return this.insufficient(base, "No revenue has been recorded in this or the previous period.", "/finance/income", "Open income");
    }
    const delta = prevFin.revenue > 0 ? ((fin.revenue - prevFin.revenue) / prevFin.revenue) * 100 : null;
    const visitDelta = prevOps.total > 0 ? ((ops.total - prevOps.total) / prevOps.total) * 100 : null;
    const factors: string[] = [];
    if (visitDelta !== null && Math.abs(visitDelta) > 5) factors.push(`patient volume moved ${visitDelta >= 0 ? "+" : ""}${visitDelta.toFixed(1)}%`);
    if (machines.length > 0) factors.push(`${machines.length} machine(s) down (${machines.map((m) => `${m.department.name} at ${m.department.branch.name}`).join(", ")})`);
    if (fin.discountValue > prevFin.discountValue && prevFin.discountValue >= 0) factors.push(`discounts rose to ${fmtIQDCompact(fin.discountValue)}`);
    if (ops.cancelled > 0) factors.push(`${ops.cancelled} cancellation(s) in period`);
    return {
      ...base,
      direct: `Revenue is ${fmtIQDCompact(fin.revenue)}${delta !== null ? `, ${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)}% vs the previous period` : ""}. ${factors.length ? `Main linked factors: ${factors.join("; ")}.` : "No single dominant factor stands out in the recorded data."}`,
      findings: [
        `Visits: ${fmtNumber(ops.total)}${visitDelta !== null ? ` (${visitDelta >= 0 ? "+" : ""}${visitDelta.toFixed(1)}%)` : ""}.`,
        `Net result: ${fmtIQDCompact(fin.net)} at ${fin.margin !== null ? fmtPercent(fin.margin * 100) : "n/a"} margin.`,
        `Discount value: ${fmtIQDCompact(fin.discountValue)}.`,
        ...(machines.length > 0 ? [`Downtime is measurable: each down machine cuts its department's daily capacity to zero while offline.`] : []),
      ],
      evidence: [
        { label: "Revenue", value: fmtIQDCompact(fin.revenue), sublabel: "this period" },
        { label: "Previous", value: fmtIQDCompact(prevFin.revenue) },
        { label: "Visits", value: fmtNumber(ops.total) },
        { label: "Cancelled", value: fmtNumber(ops.cancelled) },
        { label: "Discounts", value: fmtIQDCompact(fin.discountValue) },
      ],
      calculations: ["Revenue compares identical-length periods. Visit deltas use registration timestamps."],
      risks: machines.length > 0 ? ["Continued machine downtime directly suppresses revenue."] : [],
      actions: ["Open the finance overview for the trend chart and per-branch breakdown.", ...(machines.length > 0 ? ["Confirm machine recovery estimates in the affected departments."] : [])],
      confidence: delta !== null ? "HIGH" : "MEDIUM",
      sources: ["Income entries", "Visits", "Machines", "Discounts"],
      link: { href: "/finance", label: "Open financial overview" },
    };
  }

  // ── Shareholder ──
  private async shareholder(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const [fin, rows, alerts] = await Promise.all([
      financeSummary(req.branchIds, req.range),
      branchOverviews(req.branchIds, req.range),
      db.alert.count({ where: { severity: "CRITICAL", status: { not: "RESOLVED" } } }),
    ]);
    return {
      ...base,
      direct: `Group summary for the ownership level: revenue ${fmtIQDCompact(fin.revenue)}, expenses ${fmtIQDCompact(fin.expenses)}, net result ${fmtIQDCompact(fin.net)}. ${rows.length} branch(es) operating; ${alerts} critical alert(s) open as strategic risk indicators.`,
      findings: rows.map((r) => `${r.name}: net ${fmtIQDCompact(r.net)}, health ${r.health.total !== null ? Math.round(r.health.total) : "n/a"}/100.`),
      evidence: [
        { label: "Group revenue", value: fmtIQDCompact(fin.revenue) },
        { label: "Group expenses", value: fmtIQDCompact(fin.expenses) },
        { label: "Net result", value: fmtIQDCompact(fin.net) },
        { label: "Branches", value: String(rows.length) },
      ],
      calculations: ["Aggregate-only view: patient records, employee files, legal evidence and security detail are excluded at this level."],
      risks: alerts > 0 ? [`${alerts} unresolved critical alert(s) represent open strategic risk.`] : [],
      actions: ["Generate the formal shareholder/board PDF from the Report Builder.", "Review branch contribution on the Shareholders page."],
      confidence: "HIGH",
      sources: ["Income entries", "Expenses", "Branch health engine"],
      link: { href: "/governance/shareholders", label: "Open shareholder panel" },
    };
  }

  // ── Legal ──
  private async legal(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const comp = await complianceStats(req.branchIds);
    const missing = comp.activeEmployees - comp.acceptedAgreements;
    return {
      ...base,
      direct: `Legal accountability: ${comp.agreementRate !== null ? fmtPercent(comp.agreementRate) : "n/a"} of active employees hold an accepted agreement (${missing} missing); policy acceptance is ${comp.policyAcceptanceRate !== null ? fmtPercent(comp.policyAcceptanceRate) : "n/a"}; ${comp.pendingTotal} item(s) sit in review queues.`,
      findings: [
        missing > 0 ? `${missing} active employee(s) work without an accepted agreement — the top legal gap.` : "Every active employee holds an accepted agreement.",
        `${comp.pendingAttendanceReviews} attendance exception(s) and ${comp.pendingDiscounts} discount request(s) await review.`,
        `${comp.activePolicies} active policy version(s) currently require acceptance.`,
      ],
      evidence: [
        { label: "Agreement completion", value: comp.agreementRate !== null ? fmtPercent(comp.agreementRate) : "—" },
        { label: "Policy acceptance", value: comp.policyAcceptanceRate !== null ? fmtPercent(comp.policyAcceptanceRate) : "—" },
        { label: "Pending reviews", value: String(comp.pendingTotal) },
      ],
      calculations: ["Agreement completion = active employees with ≥1 accepted agreement ÷ active employees."],
      risks: missing > 0 ? ["Unaccepted agreements weaken the company's position in any dispute."] : [],
      actions: ["Issue missing agreements from employee pages.", "Generate evidence packages from the Legal Accountability Center when needed."],
      confidence: "HIGH",
      sources: ["Agreements", "Policies", "Review queues"],
      link: { href: "/governance/legal", label: "Open legal accountability" },
    };
  }

  // ── Security ──
  private async security(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const sec = await securityStats(req.branchIds);
    return {
      ...base,
      direct: `Security posture: ${sec.activeSessions} active session(s), ${sec.failedLogins7d} failed sign-in(s) in 7 days, ${sec.lockedUsers} locked account(s), ${sec.openSecurityIncidents} open security incident(s) and ${sec.openSecurityAlerts} open security alert(s). MFA flag coverage is ${sec.mfaCoverage !== null ? fmtPercent(sec.mfaCoverage) : "n/a"}.`,
      findings: [
        sec.failedLogins7d >= 10 ? "Failed sign-in volume is elevated — review the denied events in the audit log." : "Failed sign-in volume is normal.",
        sec.suspiciousReportDoctors > 0 ? `${sec.suspiciousReportDoctors} report doctor(s) flagged for access review.` : "No remote-access flags on report doctors.",
      ],
      evidence: [
        { label: "Active sessions", value: String(sec.activeSessions) },
        { label: "Failed logins (7d)", value: String(sec.failedLogins7d) },
        { label: "Locked accounts", value: String(sec.lockedUsers) },
        { label: "Open incidents", value: String(sec.openSecurityIncidents) },
      ],
      calculations: ["Signals come from live sessions, the audit trail and the incident register."],
      risks: sec.openSecurityIncidents > 0 ? ["Open security incidents must reach closure with root cause recorded."] : [],
      actions: ["Open the Security Center for sessions, lockouts and the control roadmap."],
      confidence: "HIGH",
      sources: ["Sessions", "Audit trail", "Incidents", "Alerts"],
      link: { href: "/security", label: "Open security center" },
    };
  }

  // ── Changes since last week ──
  private async changes(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const week = { from: new Date(Date.now() - 7 * 86400000), to: new Date() };
    const prevWeek = { from: new Date(Date.now() - 14 * 86400000), to: week.from };
    const [fin, prevFin, ops, prevOps, newAlerts, newIncidents, mgmt] = await Promise.all([
      financeSummary(req.branchIds, week),
      financeSummary(req.branchIds, prevWeek),
      visitStats(req.branchIds, week),
      visitStats(req.branchIds, prevWeek),
      db.alert.count({ where: { OR: [{ branchId: null }, { branchId: { in: req.branchIds } }], detectedAt: { gte: week.from } } }),
      db.incident.count({ where: { OR: [{ branchId: null }, { branchId: { in: req.branchIds } }], detectedAt: { gte: week.from } } }),
      db.auditEvent.count({ where: { riskLevel: "HIGH", createdAt: { gte: week.from } } }),
    ]);
    const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%` : "n/a");
    return {
      ...base,
      period: "Last 7 days vs the 7 days before",
      direct: `Since last week: revenue ${fmtIQDCompact(fin.revenue)} (${pct(fin.revenue, prevFin.revenue)}), visits ${fmtNumber(ops.total)} (${pct(ops.total, prevOps.total)}), ${newAlerts} new alert(s), ${newIncidents} new incident(s), ${mgmt} high-risk management action(s).`,
      findings: [
        `Expenses: ${fmtIQDCompact(fin.expenses)} (${pct(fin.expenses, prevFin.expenses)}).`,
        `Report backlog now: ${ops.reportBacklog}.`,
        `Cancellations this week: ${ops.cancelled}.`,
      ],
      evidence: [
        { label: "Revenue (7d)", value: fmtIQDCompact(fin.revenue), sublabel: pct(fin.revenue, prevFin.revenue) },
        { label: "Visits (7d)", value: fmtNumber(ops.total), sublabel: pct(ops.total, prevOps.total) },
        { label: "New alerts", value: String(newAlerts) },
        { label: "New incidents", value: String(newIncidents) },
      ],
      calculations: ["Week-over-week comparison of identical 7-day windows."],
      risks: [],
      actions: ["Open the dashboard for the full picture and ranked attention list."],
      confidence: "HIGH",
      sources: ["Income", "Visits", "Alerts", "Incidents", "Audit trail"],
      link: { href: "/dashboard", label: "Open dashboard" },
    };
  }

  // ── Meeting brief ──
  private async meetingBrief(req: MernaAIRequest, base: { scope: string; period: string }): Promise<MernaAIAnswer> {
    const [bottlenecks, comp, alerts] = await Promise.all([
      detectBottlenecks(req.branchIds, req.range, req.prevRange),
      complianceStats(req.branchIds),
      db.alert.findMany({
        where: { severity: "CRITICAL", status: { not: "RESOLVED" }, OR: [{ branchId: null }, { branchId: { in: req.branchIds } }] },
        take: 5,
        orderBy: { detectedAt: "desc" },
      }),
    ]);
    const agenda = [
      ...alerts.map((a) => `Critical alert: ${a.title}`),
      ...bottlenecks.slice(0, 4).map((b) => `${b.category.toLowerCase()} — ${b.metric} ${b.value} at ${b.branchName}${b.departmentName ? ` (${b.departmentName})` : ""}`),
      ...(comp.activeEmployees - comp.acceptedAgreements > 0 ? [`${comp.activeEmployees - comp.acceptedAgreements} employee(s) without accepted agreements`] : []),
      ...(comp.pendingTotal > 0 ? [`${comp.pendingTotal} pending management reviews`] : []),
    ];
    if (agenda.length === 0) {
      return {
        ...base,
        direct: "Nothing urgent for tomorrow's agenda: no critical alerts, no active bottlenecks and no legal gaps in the current data.",
        findings: ["Operations are within thresholds across the monitored rules."],
        evidence: [],
        calculations: [],
        risks: [],
        actions: ["Use the time for forward planning: budgets, expansion readiness and policy reviews."],
        confidence: "HIGH",
        sources: ["Alerts", "Bottleneck engine", "Compliance"],
        link: { href: "/dashboard", label: "Open dashboard" },
      };
    }
    return {
      ...base,
      direct: `Suggested agenda for management (${agenda.length} items), ordered by severity:`,
      findings: agenda.map((a, i) => `${i + 1}. ${a}`),
      evidence: bottlenecks.slice(0, 4).map((b) => ({ label: `${b.branchName}${b.departmentName ? ` · ${b.departmentName}` : ""}`, value: b.value, sublabel: b.metric })),
      calculations: ["Agenda is assembled from unresolved critical alerts, active bottlenecks and compliance gaps."],
      risks: bottlenecks.slice(0, 3).map((b) => b.impact),
      actions: bottlenecks.slice(0, 4).map((b) => b.action),
      confidence: "HIGH",
      sources: ["Alerts", "Bottleneck engine", "Compliance"],
      link: { href: "/reports?type=EXECUTIVE_SUMMARY", label: "Generate the executive report" },
    };
  }

  private insufficient(
    base: { scope: string; period: string },
    message: string,
    href: string,
    label: string,
  ): MernaAIAnswer {
    return {
      ...base,
      direct: message,
      findings: [],
      evidence: [],
      calculations: [],
      risks: [],
      actions: [`Start by recording the underlying data — ${label.toLowerCase()}.`],
      confidence: "HIGH",
      sources: [],
      link: { href, label },
    };
  }
}

// Masking pass: strip role-restricted content before the answer leaves the server.
export function applyAnswerMasking(answer: MernaAIAnswer, role: MernaAIRequest["userRole"]): MernaAIAnswer {
  const masking = maskingFor(role);
  if (!masking.financeDetail) return answer;
  // Shareholder-style roles: keep aggregates, drop record-level statements.
  return {
    ...answer,
    findings: answer.findings.filter((f) => !/review:|by [A-Z]/i.test(f)),
    risks: answer.risks.filter((r) => !/review:/i.test(r)),
  };
}
