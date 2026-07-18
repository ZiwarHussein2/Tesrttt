import "server-only";
import { db } from "@/lib/db";
import {
  attendanceStats, financeSummary, inventoryStats, visitStats,
} from "@/lib/analytics/metrics";

// Deterministic bottleneck detection engine. Same data sources as the
// dashboards, so every number in a bottleneck card reconciles with the UI.

export interface Bottleneck {
  key: string;
  category:
    | "QUEUE" | "STAFFING" | "MACHINE" | "REPORT" | "INVENTORY"
    | "EXPENSE" | "ATTENDANCE" | "MANAGEMENT" | "DATA_QUALITY" | "SECURITY";
  severity: "WARNING" | "CRITICAL";
  branchId: string | null;
  branchName: string;
  departmentName?: string;
  metric: string;
  value: string;
  target: string;
  likelyCause: string;
  impact: string;
  action: string;
  evidence: string[];
  link: string;
}

export async function detectBottlenecks(
  branchIds: string[],
  range: { from: Date; to: Date },
  prevRange?: { from: Date; to: Date },
): Promise<Bottleneck[]> {
  const out: Bottleneck[] = [];
  const branches = await db.branch.findMany({ where: { id: { in: branchIds } } });

  for (const b of branches) {
    const ids = [b.id];

    // ── Queue & machines per department ──
    const departments = await db.department.findMany({
      where: { branchId: b.id, status: "ACTIVE" },
      include: {
        machines: true,
        _count: { select: { visits: { where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } } } } },
      },
    });
    const deptVisits = await db.visit.findMany({
      where: { branchId: b.id, registeredAt: { gte: range.from, lt: range.to }, calledAt: { not: null } },
      select: { departmentId: true, registeredAt: true, calledAt: true },
    });

    for (const d of departments) {
      const waits = deptVisits
        .filter((v) => v.departmentId === d.id)
        .map((v) => (v.calledAt!.getTime() - v.registeredAt.getTime()) / 60000)
        .filter((m) => m >= 0 && m < 1440);
      const avgWait = waits.length ? waits.reduce((s, m) => s + m, 0) / waits.length : null;

      if (avgWait !== null && avgWait > d.targetWaitMinutes) {
        const over = avgWait - d.targetWaitMinutes;
        out.push({
          key: `wait:${d.id}`,
          category: "QUEUE",
          severity: over > d.targetWaitMinutes ? "CRITICAL" : "WARNING",
          branchId: b.id,
          branchName: b.name,
          departmentName: d.name,
          metric: "Average wait",
          value: `${Math.round(avgWait)} min`,
          target: `${d.targetWaitMinutes} min`,
          likelyCause: "Demand exceeds session capacity during peak hours, or check-in to call handoff is slow.",
          impact: "Patient dissatisfaction and lost bookings; queue pressure compounds through the day.",
          action: `Review ${d.name} scheduling and staffing at peak hours; consider extending sessions or adding capacity.`,
          evidence: [`${waits.length} timed visits in period`, `Average wait ${Math.round(avgWait)} min vs ${d.targetWaitMinutes} min target`],
          link: `/queues?department=${d.id}`,
        });
      }

      const queueLimit = Math.max(5, Math.ceil(d.dailyCapacity / 4));
      if (d._count.visits > queueLimit) {
        out.push({
          key: `queue:${d.id}`,
          category: "QUEUE",
          severity: d._count.visits > queueLimit * 2 ? "CRITICAL" : "WARNING",
          branchId: b.id,
          branchName: b.name,
          departmentName: d.name,
          metric: "Live queue size",
          value: String(d._count.visits),
          target: `≤ ${queueLimit}`,
          likelyCause: "Arrivals outpacing throughput right now.",
          impact: "Waits will exceed target within the session.",
          action: "Open the live queue and rebalance: call-forward, urgent triage, or divert bookings.",
          evidence: [`${d._count.visits} patients currently active in ${d.name}`],
          link: `/queues?department=${d.id}`,
        });
      }

      for (const m of d.machines) {
        if (m.status === "OFFLINE" || m.status === "MAINTENANCE") {
          out.push({
            key: `machine:${m.id}`,
            category: "MACHINE",
            severity: m.status === "OFFLINE" ? "CRITICAL" : "WARNING",
            branchId: b.id,
            branchName: b.name,
            departmentName: d.name,
            metric: "Machine status",
            value: m.status.toLowerCase(),
            target: "available",
            likelyCause: m.status === "MAINTENANCE" ? "Scheduled or corrective maintenance in progress." : "Unplanned equipment failure.",
            impact: `${d.name} capacity reduced; waiting patients and revenue directly affected.`,
            action: "Confirm estimated recovery, reschedule affected bookings and consider cross-branch referral.",
            evidence: [`${m.name}${m.notes ? ` — ${m.notes}` : ""}`],
            link: `/departments/${d.id}`,
          });
        }
      }
    }

    // ── Reports ──
    const ops = await visitStats(ids, range);
    if (ops.reportBacklog > 10) {
      out.push({
        key: `backlog:${b.id}`,
        category: "REPORT",
        severity: ops.reportBacklog > 30 ? "CRITICAL" : "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Report backlog",
        value: String(ops.reportBacklog),
        target: "≤ 10",
        likelyCause: "Report-doctor capacity below scan volume, or assignments not being made promptly.",
        impact: `${ops.reportOverdue} item(s) already older than 24h; patient results delayed.`,
        action: "Rebalance doctor assignments in the report workflow; consider an additional reading doctor.",
        evidence: [`${ops.reportBacklog} scans awaiting reports`, `${ops.reportOverdue} overdue >24h`],
        link: "/operations/reports",
      });
    }
    if (ops.avgReportTurnaroundHours !== null && ops.avgReportTurnaroundHours > 24) {
      out.push({
        key: `turnaround:${b.id}`,
        category: "REPORT",
        severity: ops.avgReportTurnaroundHours > 48 ? "CRITICAL" : "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Report turnaround",
        value: `${ops.avgReportTurnaroundHours.toFixed(1)}h`,
        target: "≤ 24h",
        likelyCause: "Slow reading cycle or delayed assignment after scan completion.",
        impact: "Patients wait longer for results; completion rate drops.",
        action: "Track per-doctor turnaround in the report workflow and set assignment SLAs.",
        evidence: [`Average turnaround ${ops.avgReportTurnaroundHours.toFixed(1)}h in period`],
        link: "/operations/reports",
      });
    }

    // ── Inventory ──
    const inv = await inventoryStats(ids, range);
    if (inv.wasteRate !== null && inv.wasteRate > 5) {
      out.push({
        key: `waste:${b.id}`,
        category: "INVENTORY",
        severity: inv.wasteRate > 10 ? "CRITICAL" : "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Waste rate",
        value: `${inv.wasteRate.toFixed(1)}%`,
        target: "≤ 5%",
        likelyCause: "Film/print retakes, handling damage, or unverified corrections masking usage.",
        impact: `${Math.round(inv.wasteCost).toLocaleString()} IQD lost in the period.`,
        action: "Open Waste & Variance: review flagged items, verification gaps and repeated corrections.",
        evidence: [`Waste cost ${Math.round(inv.wasteCost).toLocaleString()} IQD`, `Consumption ${Math.round(inv.consumptionCost).toLocaleString()} IQD`],
        link: "/inventory/waste",
      });
    }
    // Days of cover
    const periodDays = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000));
    const lowCover = await db.inventoryItem.findMany({
      where: { branchId: b.id, quantity: { gt: 0 } },
      include: {
        movements: {
          where: { type: { in: ["CONSUMED", "ISSUED"] }, occurredAt: { gte: range.from, lt: range.to } },
          select: { quantity: true },
        },
      },
    });
    const critical = lowCover
      .map((i) => {
        const used = i.movements.reduce((s, m) => s + Math.abs(m.quantity), 0);
        const daily = used / periodDays;
        return { name: i.name, cover: daily > 0 ? i.quantity / daily : Infinity };
      })
      .filter((x) => x.cover < 7);
    if (critical.length > 0) {
      out.push({
        key: `cover:${b.id}`,
        category: "INVENTORY",
        severity: critical.some((c) => c.cover < 3) ? "CRITICAL" : "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Days of cover",
        value: `${critical.length} item(s) < 7 days`,
        target: "≥ 7 days",
        likelyCause: "Reordering lag behind consumption rate.",
        impact: "Stock-outs can stop tests and lose revenue.",
        action: `Reorder now: ${critical.slice(0, 3).map((c) => c.name).join(", ")}${critical.length > 3 ? "…" : ""}`,
        evidence: critical.slice(0, 4).map((c) => `${c.name}: ${c.cover === Infinity ? "∞" : Math.floor(c.cover)} days left`),
        link: "/inventory",
      });
    }

    // ── Finance ──
    if (prevRange) {
      const [fin, prevFin] = await Promise.all([
        financeSummary(ids, range),
        financeSummary(ids, prevRange),
      ]);
      const expGrowth = prevFin.expenses > 0 ? (fin.expenses - prevFin.expenses) / prevFin.expenses : null;
      const revGrowth = prevFin.revenue > 0 ? (fin.revenue - prevFin.revenue) / prevFin.revenue : null;
      if (expGrowth !== null && revGrowth !== null && expGrowth > revGrowth + 0.1) {
        out.push({
          key: `exp-growth:${b.id}`,
          category: "EXPENSE",
          severity: expGrowth > revGrowth + 0.3 ? "CRITICAL" : "WARNING",
          branchId: b.id,
          branchName: b.name,
          metric: "Expense vs revenue growth",
          value: `${(expGrowth * 100).toFixed(0)}% vs ${(revGrowth * 100).toFixed(0)}%`,
          target: "expenses ≤ revenue growth",
          likelyCause: `Largest categories: ${fin.expensesByCategory.slice(0, 2).map((c) => c.category.toLowerCase()).join(", ")}.`,
          impact: "Margin compression if the trend continues.",
          action: "Open expense intelligence and review the fastest-growing categories and vendors.",
          evidence: [
            `Expenses ${Math.round(fin.expenses).toLocaleString()} IQD (prev ${Math.round(prevFin.expenses).toLocaleString()})`,
            `Revenue ${Math.round(fin.revenue).toLocaleString()} IQD (prev ${Math.round(prevFin.revenue).toLocaleString()})`,
          ],
          link: "/finance/expenses",
        });
      }
    }

    // ── Attendance / staffing ──
    const att = await attendanceStats(ids, range);
    if (att.rate !== null && att.rate < 85) {
      out.push({
        key: `attendance:${b.id}`,
        category: "ATTENDANCE",
        severity: att.rate < 75 ? "CRITICAL" : "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Attendance rate",
        value: `${att.rate.toFixed(1)}%`,
        target: "≥ 85%",
        likelyCause: `${att.absent} absence record(s) and ${att.late} late arrival(s) in period.`,
        impact: "Understaffed sessions produce queue bottlenecks and overtime cost.",
        action: "Review absence patterns in Workforce Analytics and pending exceptions in Attendance.",
        evidence: [`${att.records} attendance records in period`, `${att.exceptions} exceptions`],
        link: "/attendance",
      });
    }
    // Overtime rising while volume falls (first vs second half of range)
    const mid = new Date((range.from.getTime() + range.to.getTime()) / 2);
    const [att1, att2, ops1, ops2] = await Promise.all([
      attendanceStats(ids, { from: range.from, to: mid }),
      attendanceStats(ids, { from: mid, to: range.to }),
      visitStats(ids, { from: range.from, to: mid }),
      visitStats(ids, { from: mid, to: range.to }),
    ]);
    if (
      att1.totalOvertimeMinutes > 0 &&
      att2.totalOvertimeMinutes > att1.totalOvertimeMinutes * 1.2 &&
      ops2.total < ops1.total * 0.9
    ) {
      out.push({
        key: `ot-volume:${b.id}`,
        category: "STAFFING",
        severity: "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Overtime vs volume",
        value: `OT +${Math.round(((att2.totalOvertimeMinutes - att1.totalOvertimeMinutes) / att1.totalOvertimeMinutes) * 100)}%, visits ${Math.round(((ops2.total - ops1.total) / Math.max(1, ops1.total)) * 100)}%`,
        target: "overtime tracks volume",
        likelyCause: "Shift planning not adjusted to lower demand, or workload concentrated on few staff.",
        impact: "Payroll cost rising while output falls.",
        action: "Compare overtime by employee and align schedules with actual patient volume.",
        evidence: [
          `First half OT ${Math.round(att1.totalOvertimeMinutes / 60)}h, second half ${Math.round(att2.totalOvertimeMinutes / 60)}h`,
          `Visits ${ops1.total} → ${ops2.total}`,
        ],
        link: "/overtime",
      });
    }

    // ── Management review backlog ──
    const [pendingExp, pendingAtt, pendingDisc] = await Promise.all([
      db.expense.count({ where: { branchId: b.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      db.attendanceRecord.count({ where: { branchId: b.id, reviewStatus: "PENDING" } }),
      db.discountRequest.count({ where: { branchId: b.id, status: "PENDING" } }),
    ]);
    const pending = pendingExp + pendingAtt + pendingDisc;
    if (pending > 8) {
      out.push({
        key: `reviews:${b.id}`,
        category: "MANAGEMENT",
        severity: pending > 20 ? "CRITICAL" : "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Pending reviews",
        value: String(pending),
        target: "≤ 8",
        likelyCause: "Approval workload concentrated or unattended.",
        impact: "Delayed financial accuracy and weakened accountability evidence.",
        action: `Clear the queues: ${pendingExp} expenses, ${pendingAtt} attendance exceptions, ${pendingDisc} discounts.`,
        evidence: [`${pendingExp} expenses`, `${pendingAtt} attendance exceptions`, `${pendingDisc} discount requests`],
        link: "/management-activities",
      });
    }

    // ── Data quality ──
    const unscheduled = await db.visit.count({
      where: { branchId: b.id, registeredAt: { gte: range.from, lt: range.to }, serviceId: null },
    });
    if (unscheduled > 0) {
      out.push({
        key: `dq-service:${b.id}`,
        category: "DATA_QUALITY",
        severity: "WARNING",
        branchId: b.id,
        branchName: b.name,
        metric: "Visits without service",
        value: String(unscheduled),
        target: "0",
        likelyCause: "Registrations recorded without selecting a service.",
        impact: "Pricing, recipes and department analytics lose accuracy.",
        action: "Ensure reception selects a service at registration.",
        evidence: [`${unscheduled} visit(s) missing a service in period`],
        link: "/patients",
      });
    }
  }

  // ── Group security ──
  const secAlerts = await db.alert.count({
    where: { category: { in: ["SECURITY", "PRIVACY"] }, status: { not: "RESOLVED" } },
  });
  if (secAlerts > 0) {
    out.push({
      key: "security:open",
      category: "SECURITY",
      severity: "WARNING",
      branchId: null,
      branchName: "Group",
      metric: "Unresolved security alerts",
      value: String(secAlerts),
      target: "0",
      likelyCause: "Security or privacy alerts have not been triaged.",
      impact: "Unattended security signals age poorly and weaken audit posture.",
      action: "Triage security alerts and open incidents where investigation is needed.",
      evidence: [`${secAlerts} open security/privacy alert(s)`],
      link: "/security",
    });
  }

  const rank = { CRITICAL: 0, WARNING: 1 } as const;
  return out.sort((a, b2) => rank[a.severity] - rank[b2.severity]);
}
