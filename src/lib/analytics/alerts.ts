import "server-only";
import { db } from "@/lib/db";
import { financeSummary, inventoryStats, attendanceStats } from "@/lib/analytics/metrics";
import { rangeBounds } from "@/lib/scope";

// Deterministic alert engine. Evaluates threshold rules over live data and
// maintains open alerts keyed by ruleKey (no duplicates while open).
// Runs at most every 10 minutes (tracked in Setting "alerts.lastScan").

const SCAN_INTERVAL_MS = 10 * 60 * 1000;

interface Candidate {
  ruleKey: string;
  branchId?: string;
  departmentId?: string;
  category: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  metric?: string;
  value?: number;
  threshold?: number;
}

export async function maybeRunAlertScan(force = false): Promise<{ ran: boolean; created: number; autoResolved: number }> {
  const last = await db.setting.findUnique({ where: { key: "alerts.lastScan" } });
  if (!force && last) {
    const lastTime = new Date(JSON.parse(last.value) as string).getTime();
    if (Date.now() - lastTime < SCAN_INTERVAL_MS) return { ran: false, created: 0, autoResolved: 0 };
  }

  const candidates: Candidate[] = [];
  const { from, to, prevFrom, prevTo } = rangeBounds("30d");
  const range = { from, to };

  const branches = await db.branch.findMany({ where: { status: { notIn: ["CLOSED"] } } });

  for (const b of branches) {
    const ids = [b.id];

    // ── Queue & waits per department ──
    const departments = await db.department.findMany({
      where: { branchId: b.id, status: "ACTIVE" },
      include: {
        machines: true,
        _count: { select: { visits: { where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } } } } },
      },
    });
    for (const d of departments) {
      const queueSize = d._count.visits;
      const queueLimit = Math.max(5, Math.ceil(d.dailyCapacity / 4));
      if (queueSize > queueLimit) {
        candidates.push({
          ruleKey: `queue-size:${d.id}`,
          branchId: b.id,
          departmentId: d.id,
          category: "QUEUE",
          severity: queueSize > queueLimit * 2 ? "CRITICAL" : "WARNING",
          title: `${d.name} queue exceeds capacity threshold — ${b.name}`,
          description: `${queueSize} patients are in the ${d.name} queue (threshold ${queueLimit}). Review staffing, machine availability and scheduling. Suggested action: add a session or redirect bookings.`,
          metric: "queue_size",
          value: queueSize,
          threshold: queueLimit,
        });
      }
      for (const m of d.machines) {
        if (m.status === "OFFLINE" || m.status === "MAINTENANCE") {
          candidates.push({
            ruleKey: `machine:${m.id}`,
            branchId: b.id,
            departmentId: d.id,
            category: "MACHINE",
            severity: m.status === "OFFLINE" ? "CRITICAL" : "WARNING",
            title: `${m.name} is ${m.status.toLowerCase()} — ${d.name}, ${b.name}`,
            description: `Machine downtime reduces ${d.name} capacity and affects revenue. Suggested action: confirm recovery time and reschedule affected bookings.`,
            metric: "machine_status",
          });
        }
      }
    }

    // ── Report backlog ──
    const backlog = await db.visit.count({
      where: { branchId: b.id, reportRequired: true, status: { in: ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING"] } },
    });
    if (backlog > 10) {
      candidates.push({
        ruleKey: `report-backlog:${b.id}`,
        branchId: b.id,
        category: "REPORT_DELAY",
        severity: backlog > 30 ? "CRITICAL" : "WARNING",
        title: `Report backlog at ${backlog} — ${b.name}`,
        description: `${backlog} completed scans still need written reports (threshold 10). Suggested action: review report-doctor workload and assignments.`,
        metric: "report_backlog",
        value: backlog,
        threshold: 10,
      });
    }

    // ── Inventory ──
    const inv = await inventoryStats(ids, range);
    if (inv.outOfStock > 0) {
      candidates.push({
        ruleKey: `stock-out:${b.id}`,
        branchId: b.id,
        category: "INVENTORY",
        severity: "CRITICAL",
        title: `${inv.outOfStock} item(s) out of stock — ${b.name}`,
        description: `Out-of-stock consumables can stop tests. Suggested action: raise purchase orders and check pending receipts.`,
        metric: "out_of_stock",
        value: inv.outOfStock,
        threshold: 0,
      });
    } else if (inv.lowStock > 0) {
      candidates.push({
        ruleKey: `stock-low:${b.id}`,
        branchId: b.id,
        category: "INVENTORY",
        severity: "WARNING",
        title: `${inv.lowStock} item(s) below minimum level — ${b.name}`,
        description: `Stock is at or below the configured minimum. Suggested action: reorder before days-of-cover run out.`,
        metric: "low_stock",
        value: inv.lowStock,
        threshold: 0,
      });
    }
    if (inv.wasteRate !== null && inv.wasteRate > 5) {
      candidates.push({
        ruleKey: `waste-rate:${b.id}`,
        branchId: b.id,
        category: "WASTE",
        severity: inv.wasteRate > 10 ? "CRITICAL" : "WARNING",
        title: `Inventory waste at ${inv.wasteRate.toFixed(1)}% — ${b.name}`,
        description: `Waste exceeds the 5% threshold (30-day window). Suggested action: open Waste & Variance and review the flagged items and correction patterns.`,
        metric: "waste_rate",
        value: Math.round(inv.wasteRate * 10) / 10,
        threshold: 5,
      });
    }

    // ── Finance ──
    const [fin, prevFin] = await Promise.all([
      financeSummary(ids, range),
      financeSummary(ids, { from: prevFrom, to: prevTo }),
    ]);
    if (prevFin.expenses > 0 && fin.expenses > prevFin.expenses * 1.25) {
      const growth = ((fin.expenses - prevFin.expenses) / prevFin.expenses) * 100;
      candidates.push({
        ruleKey: `expense-growth:${b.id}`,
        branchId: b.id,
        category: "EXPENSE",
        severity: growth > 50 ? "CRITICAL" : "WARNING",
        title: `Expenses up ${growth.toFixed(0)}% vs previous period — ${b.name}`,
        description: `Approved expenses grew faster than the 25% threshold. Suggested action: open expense intelligence and review the fastest-growing categories.`,
        metric: "expense_growth_pct",
        value: Math.round(growth),
        threshold: 25,
      });
    }
    if (fin.revenue > 0 && fin.net < 0) {
      candidates.push({
        ruleKey: `negative-net:${b.id}`,
        branchId: b.id,
        category: "FINANCIAL",
        severity: "CRITICAL",
        title: `Negative net result — ${b.name}`,
        description: `Expenses exceed revenue in the last 30 days. Suggested action: review expense composition and pricing.`,
        metric: "net_result",
        value: fin.net,
        threshold: 0,
      });
    }

    // Budget overrun (current month, whole-branch budget)
    const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const budget = await db.budget.findFirst({ where: { branchId: b.id, period, category: null } });
    if (budget && budget.amount > 0) {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const actual = await db.expense.aggregate({
        where: { branchId: b.id, status: "APPROVED", expenseDate: { gte: monthStart } },
        _sum: { amount: true },
      });
      const spent = actual._sum.amount ?? 0;
      if (spent > budget.amount) {
        candidates.push({
          ruleKey: `budget-overrun:${b.id}:${period}`,
          branchId: b.id,
          category: "FINANCIAL",
          severity: "CRITICAL",
          title: `Budget overrun for ${period} — ${b.name}`,
          description: `Approved expenses (${Math.round(spent).toLocaleString()} IQD) exceed the monthly budget (${Math.round(budget.amount).toLocaleString()} IQD).`,
          metric: "budget_utilization_pct",
          value: Math.round((spent / budget.amount) * 100),
          threshold: 100,
        });
      }
    }

    // ── Attendance ──
    const att = await attendanceStats(ids, range);
    if (att.rate !== null && att.rate < 85) {
      candidates.push({
        ruleKey: `attendance:${b.id}`,
        branchId: b.id,
        category: "ATTENDANCE",
        severity: att.rate < 75 ? "CRITICAL" : "WARNING",
        title: `Attendance at ${att.rate.toFixed(1)}% — ${b.name}`,
        description: `Attendance is below the 85% target over the last 30 days. Suggested action: review absence patterns and staffing pressure.`,
        metric: "attendance_rate",
        value: Math.round(att.rate * 10) / 10,
        threshold: 85,
      });
    }
    const pendingAttendance = await db.attendanceRecord.count({ where: { branchId: b.id, reviewStatus: "PENDING" } });
    if (pendingAttendance > 5) {
      candidates.push({
        ruleKey: `attendance-reviews:${b.id}`,
        branchId: b.id,
        category: "MANAGEMENT",
        severity: "WARNING",
        title: `${pendingAttendance} attendance exceptions awaiting review — ${b.name}`,
        description: `Unreviewed exceptions weaken legal accountability. Suggested action: process the review queue in Attendance.`,
        metric: "pending_reviews",
        value: pendingAttendance,
        threshold: 5,
      });
    }

    // ── Agreements ──
    const [activeEmployees, withAgreement] = await Promise.all([
      db.employee.count({ where: { branchId: b.id, employmentStatus: "ACTIVE" } }),
      db.employee.count({ where: { branchId: b.id, employmentStatus: "ACTIVE", agreements: { some: { status: "ACCEPTED" } } } }),
    ]);
    const missing = activeEmployees - withAgreement;
    if (missing > 0) {
      candidates.push({
        ruleKey: `agreements-missing:${b.id}`,
        branchId: b.id,
        category: "AGREEMENT",
        severity: missing > 5 ? "CRITICAL" : "WARNING",
        title: `${missing} active employee(s) without an accepted agreement — ${b.name}`,
        description: `Employees working without accepted agreements are a legal-accountability gap. Suggested action: issue and record acceptance from each employee's page.`,
        metric: "missing_agreements",
        value: missing,
        threshold: 0,
      });
    }
  }

  // ── Group-level: security ──
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600000);
  const failedLogins = await db.auditEvent.count({
    where: { action: "auth.login", result: "DENIED", createdAt: { gte: weekAgo } },
  });
  if (failedLogins >= 10) {
    candidates.push({
      ruleKey: "security:failed-logins",
      category: "SECURITY",
      severity: failedLogins >= 25 ? "CRITICAL" : "WARNING",
      title: `${failedLogins} failed sign-in attempts in 7 days`,
      description: `Elevated failed-login volume. Suggested action: review the audit log for repeated sources and confirm affected accounts.`,
      metric: "failed_logins_7d",
      value: failedLogins,
      threshold: 10,
    });
  }
  const pendingExpensesAll = await db.expense.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } });
  if (pendingExpensesAll > 10) {
    candidates.push({
      ruleKey: "management:pending-expenses",
      category: "MANAGEMENT",
      severity: "WARNING",
      title: `${pendingExpensesAll} expenses awaiting review`,
      description: `A growing review backlog delays financial accuracy. Suggested action: process the expense review queue.`,
      metric: "pending_expenses",
      value: pendingExpensesAll,
      threshold: 10,
    });
  }

  // ── Reconcile with existing open alerts ──
  const openSystemAlerts = await db.alert.findMany({ where: { source: "SYSTEM", status: { not: "RESOLVED" } } });
  const openByKey = new Map(openSystemAlerts.filter((a) => a.ruleKey).map((a) => [a.ruleKey!, a]));
  const candidateKeys = new Set(candidates.map((c) => c.ruleKey));

  let created = 0;
  for (const c of candidates) {
    const existing = openByKey.get(c.ruleKey);
    if (existing) {
      await db.alert.update({
        where: { id: existing.id },
        data: { value: c.value, threshold: c.threshold, severity: c.severity, title: c.title, description: c.description },
      });
    } else {
      await db.alert.create({
        data: {
          branchId: c.branchId,
          departmentId: c.departmentId,
          category: c.category,
          severity: c.severity,
          title: c.title,
          description: c.description,
          metric: c.metric,
          value: c.value,
          threshold: c.threshold,
          source: "SYSTEM",
          ruleKey: c.ruleKey,
        },
      });
      created++;
      // Critical alerts notify leadership and the affected branch admin.
      if (c.severity === "CRITICAL") {
        const recipients = await db.user.findMany({
          where: {
            isActive: true,
            OR: [
              { role: { in: ["SUPER_ADMIN", "EXECUTIVE"] } },
              ...(c.branchId ? [{ role: "BRANCH_ADMIN", branchId: c.branchId }] : []),
            ],
          },
          select: { id: true },
        });
        if (recipients.length) {
          await db.notification.createMany({
            data: recipients.map((r) => ({
              userId: r.id,
              category: "CRITICAL_ALERT",
              title: c.title,
              body: c.description,
              link: "/alerts",
            })),
          });
        }
      }
    }
  }

  // Auto-resolve system alerts whose condition cleared.
  let autoResolved = 0;
  for (const a of openSystemAlerts) {
    if (a.ruleKey && !candidateKeys.has(a.ruleKey)) {
      await db.alert.update({
        where: { id: a.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), notes: (a.notes ? a.notes + "\n" : "") + "Auto-resolved: condition cleared." },
      });
      autoResolved++;
    }
  }

  await db.setting.upsert({
    where: { key: "alerts.lastScan" },
    update: { value: JSON.stringify(new Date().toISOString()) },
    create: { key: "alerts.lastScan", value: JSON.stringify(new Date().toISOString()) },
  });

  return { ran: true, created, autoResolved };
}
