import "server-only";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for every figure in the system. Dashboards, branch
// pages, Merna AI answers and generated PDFs all call these functions, so
// numbers always reconcile across surfaces.
// ─────────────────────────────────────────────────────────────────────────────

export interface Range {
  from: Date;
  to: Date;
}

function inRange(field: string, range: Range) {
  return { [field]: { gte: range.from, lt: range.to } };
}

function branchIn(branchIds: string[]) {
  return { branchId: { in: branchIds } };
}

// ── Finance ──

export interface FinanceSummary {
  revenue: number;
  expenses: number; // approved expenses
  pendingExpenses: number; // submitted / under review
  net: number;
  margin: number | null; // net / revenue
  payrollExpense: number;
  reimbursements: number;
  discountValue: number;
  wasteCost: number;
  expensesByCategory: { category: string; amount: number }[];
  incomeByMethod: { method: string; amount: number }[];
  incomeByCategory: { category: string; amount: number }[];
}

export async function financeSummary(branchIds: string[], range: Range): Promise<FinanceSummary> {
  const [income, approvedExpenses, pendingExpenses, byCategory, byMethod, byIncomeCat, discounts, waste] =
    await Promise.all([
      db.incomeEntry.aggregate({
        where: { ...branchIn(branchIds), ...inRange("receivedAt", range) },
        _sum: { amount: true },
      }),
      db.expense.aggregate({
        where: { ...branchIn(branchIds), status: "APPROVED", ...inRange("expenseDate", range) },
        _sum: { amount: true },
      }),
      db.expense.aggregate({
        where: { ...branchIn(branchIds), status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, ...inRange("expenseDate", range) },
        _sum: { amount: true },
      }),
      db.expense.groupBy({
        by: ["category"],
        where: { ...branchIn(branchIds), status: "APPROVED", ...inRange("expenseDate", range) },
        _sum: { amount: true },
      }),
      db.incomeEntry.groupBy({
        by: ["method"],
        where: { ...branchIn(branchIds), ...inRange("receivedAt", range) },
        _sum: { amount: true },
      }),
      db.incomeEntry.groupBy({
        by: ["category"],
        where: { ...branchIn(branchIds), ...inRange("receivedAt", range) },
        _sum: { amount: true },
      }),
      db.visit.aggregate({
        where: { ...branchIn(branchIds), ...inRange("registeredAt", range), status: { not: "CANCELLED" } },
        _sum: { discountAmount: true },
      }),
      wasteCost(branchIds, range),
    ]);

  const revenue = income._sum.amount ?? 0;
  const expenses = approvedExpenses._sum.amount ?? 0;
  const net = revenue - expenses;
  const payroll = byCategory
    .filter((c) => c.category === "SALARIES" || c.category === "OVERTIME")
    .reduce((s, c) => s + (c._sum.amount ?? 0), 0);
  const reimbursements = byCategory
    .filter((c) => c.category === "REIMBURSEMENTS")
    .reduce((s, c) => s + (c._sum.amount ?? 0), 0);

  return {
    revenue,
    expenses,
    pendingExpenses: pendingExpenses._sum.amount ?? 0,
    net,
    margin: revenue > 0 ? net / revenue : null,
    payrollExpense: payroll,
    reimbursements,
    discountValue: discounts._sum.discountAmount ?? 0,
    wasteCost: waste,
    expensesByCategory: byCategory
      .map((c) => ({ category: c.category, amount: c._sum.amount ?? 0 }))
      .sort((a, b) => b.amount - a.amount),
    incomeByMethod: byMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0 })),
    incomeByCategory: byIncomeCat.map((m) => ({ category: m.category, amount: m._sum.amount ?? 0 })),
  };
}

export async function wasteCost(branchIds: string[], range: Range): Promise<number> {
  const movements = await db.inventoryMovement.findMany({
    where: { ...branchIn(branchIds), type: "WASTED", ...inRange("occurredAt", range) },
    include: { item: { select: { unitCost: true } } },
  });
  return movements.reduce((s, m) => s + Math.abs(m.quantity) * m.item.unitCost, 0);
}

// ── Visits / operations ──

export interface VisitStats {
  total: number;
  completed: number;
  cancelled: number;
  inQueue: number; // currently active queue across scope (not range-bound)
  avgWaitMinutes: number | null; // registered → called
  avgDurationMinutes: number | null; // scan start → scan end
  reportBacklog: number; // current: report required but not completed
  reportOverdue: number; // backlog older than 24h since scan completion
  avgReportTurnaroundHours: number | null;
  completionRate: number | null;
  byDepartmentType: { type: string; count: number }[];
  funnel: { label: string; value: number }[];
}

const BACKLOG_STATUSES = ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING"];

export async function visitStats(branchIds: string[], range: Range): Promise<VisitStats> {
  const [visits, backlogVisits, inQueue] = await Promise.all([
    db.visit.findMany({
      where: { ...branchIn(branchIds), ...inRange("registeredAt", range) },
      select: {
        status: true,
        registeredAt: true,
        calledAt: true,
        scanStartedAt: true,
        scanCompletedAt: true,
        reportCompletedAt: true,
        reportRequired: true,
        department: { select: { type: true } },
      },
    }),
    db.visit.findMany({
      where: { ...branchIn(branchIds), reportRequired: true, status: { in: BACKLOG_STATUSES } },
      select: { scanCompletedAt: true },
    }),
    db.visit.count({
      where: { ...branchIn(branchIds), status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } },
    }),
  ]);

  const completed = visits.filter((v) => v.status === "COMPLETED").length;
  const cancelled = visits.filter((v) => v.status === "CANCELLED").length;

  const waits = visits
    .filter((v) => v.calledAt)
    .map((v) => (v.calledAt!.getTime() - v.registeredAt.getTime()) / 60000)
    .filter((m) => m >= 0 && m < 24 * 60);
  const durations = visits
    .filter((v) => v.scanStartedAt && v.scanCompletedAt)
    .map((v) => (v.scanCompletedAt!.getTime() - v.scanStartedAt!.getTime()) / 60000)
    .filter((m) => m > 0 && m < 12 * 60);
  const turnarounds = visits
    .filter((v) => v.scanCompletedAt && v.reportCompletedAt)
    .map((v) => (v.reportCompletedAt!.getTime() - v.scanCompletedAt!.getTime()) / 3600000)
    .filter((h) => h >= 0 && h < 30 * 24);

  const byType = new Map<string, number>();
  for (const v of visits) byType.set(v.department.type, (byType.get(v.department.type) ?? 0) + 1);

  const overdueCutoff = Date.now() - 24 * 3600000;
  const reportOverdue = backlogVisits.filter(
    (v) => v.scanCompletedAt && v.scanCompletedAt.getTime() < overdueCutoff,
  ).length;

  const stage = (statuses: string[]) => visits.filter((v) => statuses.includes(v.status)).length;
  const funnel = [
    { label: "Registered", value: visits.length },
    { label: "Paid", value: visits.length - stage(["REGISTERED", "CANCELLED"]) },
    { label: "Scan completed", value: stage(["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING", "REPORT_COMPLETED", "COMPLETED"]) },
    { label: "Report completed", value: stage(["REPORT_COMPLETED", "COMPLETED"]) + visits.filter((v) => v.status === "COMPLETED" && !v.reportRequired).length },
    { label: "Completed", value: completed },
  ];

  return {
    total: visits.length,
    completed,
    cancelled,
    inQueue,
    avgWaitMinutes: waits.length ? waits.reduce((s, m) => s + m, 0) / waits.length : null,
    avgDurationMinutes: durations.length ? durations.reduce((s, m) => s + m, 0) / durations.length : null,
    reportBacklog: backlogVisits.length,
    reportOverdue,
    avgReportTurnaroundHours: turnarounds.length ? turnarounds.reduce((s, h) => s + h, 0) / turnarounds.length : null,
    completionRate: visits.length ? completed / visits.length : null,
    byDepartmentType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    funnel,
  };
}

// ── Attendance ──

export interface AttendanceStats {
  records: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  rate: number | null; // (present + late) / (records − holiday)
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  exceptions: number;
  missingCheckout: number;
  activeEmployees: number;
}

export async function attendanceStats(branchIds: string[], range: Range): Promise<AttendanceStats> {
  const [records, activeEmployees] = await Promise.all([
    db.attendanceRecord.findMany({
      where: { ...branchIn(branchIds), ...inRange("date", range) },
      select: {
        status: true,
        lateMinutes: true,
        overtimeMinutes: true,
        exception: true,
        checkIn: true,
        checkOut: true,
      },
    }),
    db.employee.count({ where: { ...branchIn(branchIds), employmentStatus: "ACTIVE" } }),
  ]);

  const present = records.filter((r) => r.status === "PRESENT").length;
  const late = records.filter((r) => r.status === "LATE").length;
  const absent = records.filter((r) => r.status === "ABSENT").length;
  const leave = records.filter((r) => r.status === "LEAVE").length;
  const workingRecords = records.filter((r) => r.status !== "HOLIDAY").length;

  return {
    records: records.length,
    present,
    late,
    absent,
    leave,
    rate: workingRecords > 0 ? ((present + late) / workingRecords) * 100 : null,
    totalLateMinutes: records.reduce((s, r) => s + r.lateMinutes, 0),
    totalOvertimeMinutes: records.reduce((s, r) => s + r.overtimeMinutes, 0),
    exceptions: records.filter((r) => r.exception).length,
    missingCheckout: records.filter((r) => r.checkIn && !r.checkOut).length,
    activeEmployees,
  };
}

// ── Inventory ──

export interface InventoryStats {
  stockValue: number;
  itemCount: number;
  lowStock: number;
  outOfStock: number;
  consumptionCost: number;
  wasteCost: number;
  wasteRate: number | null; // waste / (consumed + waste), by cost
  correctionsCount: number;
}

export async function inventoryStats(branchIds: string[], range: Range): Promise<InventoryStats> {
  const [items, movements] = await Promise.all([
    db.inventoryItem.findMany({ where: branchIn(branchIds), select: { quantity: true, minimumLevel: true, unitCost: true } }),
    db.inventoryMovement.findMany({
      where: { ...branchIn(branchIds), ...inRange("occurredAt", range), type: { in: ["CONSUMED", "WASTED", "CORRECTED"] } },
      include: { item: { select: { unitCost: true } } },
    }),
  ]);

  const consumed = movements
    .filter((m) => m.type === "CONSUMED")
    .reduce((s, m) => s + Math.abs(m.quantity) * m.item.unitCost, 0);
  const wasted = movements
    .filter((m) => m.type === "WASTED")
    .reduce((s, m) => s + Math.abs(m.quantity) * m.item.unitCost, 0);

  return {
    stockValue: items.reduce((s, i) => s + i.quantity * i.unitCost, 0),
    itemCount: items.length,
    lowStock: items.filter((i) => i.quantity > 0 && i.quantity <= i.minimumLevel).length,
    outOfStock: items.filter((i) => i.quantity <= 0).length,
    consumptionCost: consumed,
    wasteCost: wasted,
    wasteRate: consumed + wasted > 0 ? (wasted / (consumed + wasted)) * 100 : null,
    correctionsCount: movements.filter((m) => m.type === "CORRECTED").length,
  };
}

// ── Compliance ──

export interface ComplianceStats {
  activeEmployees: number;
  acceptedAgreements: number;
  agreementRate: number | null;
  activePolicies: number;
  policyAcceptanceRate: number | null;
  pendingExpenseReviews: number;
  pendingAttendanceReviews: number;
  pendingDiscounts: number;
  pendingTotal: number;
}

export async function complianceStats(branchIds: string[]): Promise<ComplianceStats> {
  const [activeEmployees, acceptedAgreements, activePolicies, acceptances, pendingExpenses, pendingAttendance, pendingDiscounts] =
    await Promise.all([
      db.employee.count({ where: { ...branchIn(branchIds), employmentStatus: "ACTIVE" } }),
      db.employee.count({
        where: {
          ...branchIn(branchIds),
          employmentStatus: "ACTIVE",
          agreements: { some: { status: "ACCEPTED" } },
        },
      }),
      db.policy.count({ where: { status: "ACTIVE" } }),
      db.policyAcceptance.count({
        where: { policy: { status: "ACTIVE" }, employee: { ...branchIn(branchIds), employmentStatus: "ACTIVE" } },
      }),
      db.expense.count({ where: { ...branchIn(branchIds), status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      db.attendanceRecord.count({ where: { ...branchIn(branchIds), reviewStatus: "PENDING" } }),
      db.discountRequest.count({ where: { ...branchIn(branchIds), status: "PENDING" } }),
    ]);

  const policySlots = activePolicies * activeEmployees;

  return {
    activeEmployees,
    acceptedAgreements,
    agreementRate: activeEmployees > 0 ? (acceptedAgreements / activeEmployees) * 100 : null,
    activePolicies,
    policyAcceptanceRate: policySlots > 0 ? (acceptances / policySlots) * 100 : null,
    pendingExpenseReviews: pendingExpenses,
    pendingAttendanceReviews: pendingAttendance,
    pendingDiscounts,
    pendingTotal: pendingExpenses + pendingAttendance + pendingDiscounts,
  };
}

// ── Security ──

export interface SecurityStats {
  users: number;
  mfaCoverage: number | null;
  lockedUsers: number;
  failedLogins7d: number;
  openSecurityIncidents: number;
  openSecurityAlerts: number;
  suspiciousReportDoctors: number;
  activeSessions: number;
}

export async function securityStats(branchIds: string[]): Promise<SecurityStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600000);
  const [users, mfaUsers, lockedUsers, failedLogins, openIncidents, openAlerts, suspiciousDoctors, activeSessions] =
    await Promise.all([
      db.user.count({ where: { isActive: true } }),
      db.user.count({ where: { isActive: true, mfaEnabled: true } }),
      db.user.count({ where: { lockedUntil: { gt: new Date() } } }),
      db.auditEvent.count({ where: { action: "auth.login", result: "DENIED", createdAt: { gte: weekAgo } } }),
      db.incident.count({
        where: {
          type: { in: ["SECURITY", "ACCESS_CONTROL", "PRIVACY"] },
          status: { notIn: ["CLOSED", "RESOLVED", "REVIEWED"] },
          OR: [{ branchId: null }, branchIn(branchIds)],
        },
      }),
      db.alert.count({
        where: {
          category: { in: ["SECURITY", "PRIVACY"] },
          status: { not: "RESOLVED" },
          OR: [{ branchId: null }, branchIn(branchIds)],
        },
      }),
      db.reportDoctor.count({ where: { suspiciousFlag: true } }),
      db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);

  return {
    users,
    mfaCoverage: users > 0 ? (mfaUsers / users) * 100 : null,
    lockedUsers,
    failedLogins7d: failedLogins,
    openSecurityIncidents: openIncidents,
    openSecurityAlerts: openAlerts,
    suspiciousReportDoctors: suspiciousDoctors,
    activeSessions,
  };
}

// ── Trend series (daily buckets for charts) ──

export interface DayPoint {
  label: string;
  [key: string]: string | number;
}

export function dayBuckets(range: Range, maxPoints = 31): { start: Date; end: Date; label: string }[] {
  const dayMs = 24 * 3600000;
  const totalDays = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / dayMs));
  const step = Math.max(1, Math.ceil(totalDays / maxPoints));
  const buckets: { start: Date; end: Date; label: string }[] = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += step * dayMs) {
    const start = new Date(t);
    const end = new Date(Math.min(t + step * dayMs, range.to.getTime()));
    buckets.push({
      start,
      end,
      label: start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    });
  }
  return buckets;
}

export async function revenueExpenseTrend(branchIds: string[], range: Range): Promise<DayPoint[]> {
  const buckets = dayBuckets(range);
  const [income, expenses] = await Promise.all([
    db.incomeEntry.findMany({
      where: { ...branchIn(branchIds), ...inRange("receivedAt", range) },
      select: { amount: true, receivedAt: true },
    }),
    db.expense.findMany({
      where: { ...branchIn(branchIds), status: "APPROVED", ...inRange("expenseDate", range) },
      select: { amount: true, expenseDate: true },
    }),
  ]);
  return buckets.map((b) => {
    const rev = income.filter((i) => i.receivedAt >= b.start && i.receivedAt < b.end).reduce((s, i) => s + i.amount, 0);
    const exp = expenses.filter((e) => e.expenseDate >= b.start && e.expenseDate < b.end).reduce((s, e) => s + e.amount, 0);
    return { label: b.label, revenue: rev, expenses: exp, net: rev - exp };
  });
}

export async function visitTrend(branchIds: string[], range: Range): Promise<DayPoint[]> {
  const buckets = dayBuckets(range);
  const visits = await db.visit.findMany({
    where: { ...branchIn(branchIds), ...inRange("registeredAt", range) },
    select: { registeredAt: true },
  });
  return buckets.map((b) => ({
    label: b.label,
    visits: visits.filter((v) => v.registeredAt >= b.start && v.registeredAt < b.end).length,
  }));
}

// ── Branch health score ──

export interface HealthComponent {
  key: string;
  label: string;
  weight: number;
  score: number | null; // null = insufficient data
  detail: string;
}

export interface HealthScore {
  total: number | null;
  components: HealthComponent[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

export async function branchHealth(branchId: string, range: Range): Promise<HealthScore> {
  const ids = [branchId];
  const [fin, ops, att, inv, comp, sec, departments] = await Promise.all([
    financeSummary(ids, range),
    visitStats(ids, range),
    attendanceStats(ids, range),
    inventoryStats(ids, range),
    complianceStats(ids),
    securityStats(ids),
    db.department.findMany({ where: { branchId }, select: { targetWaitMinutes: true } }),
  ]);

  const targetWait = departments.length
    ? departments.reduce((s, d) => s + d.targetWaitMinutes, 0) / departments.length
    : 30;

  // Finance: operating margin. 30%+ margin = 100; 0% = 40; −20% or worse = 0.
  const finance: HealthComponent = {
    key: "finance",
    label: "Finance",
    weight: 25,
    score: fin.revenue > 0 ? clamp(40 + (fin.margin ?? 0) * 200) : null,
    detail: fin.revenue > 0
      ? `Operating margin ${(100 * (fin.margin ?? 0)).toFixed(1)}% → 40 + margin × 200`
      : "No revenue recorded in period",
  };

  // Operations: wait vs target and report backlog.
  let opsScore: number | null = null;
  let opsDetail = "No visits recorded in period";
  if (ops.total > 0) {
    const waitPenalty = ops.avgWaitMinutes !== null ? Math.max(0, ops.avgWaitMinutes - targetWait) * 2.5 : 0;
    const backlogPenalty = Math.min(30, ops.reportBacklog * 1.5);
    opsScore = clamp(100 - waitPenalty - backlogPenalty);
    opsDetail = `100 − wait overage ×2.5 (${ops.avgWaitMinutes?.toFixed(0) ?? "–"} vs ${targetWait.toFixed(0)} min target) − backlog ×1.5 (${ops.reportBacklog})`;
  }
  const operations: HealthComponent = { key: "operations", label: "Operations", weight: 25, score: opsScore, detail: opsDetail };

  // Workforce: attendance rate. 95%+ = 100; 70% = 0.
  const workforce: HealthComponent = {
    key: "workforce",
    label: "Workforce",
    weight: 15,
    score: att.rate !== null ? clamp(((att.rate - 70) / 25) * 100) : null,
    detail: att.rate !== null ? `Attendance ${att.rate.toFixed(1)}% → (rate − 70) / 25 × 100` : "No attendance records in period",
  };

  // Inventory: waste rate. 0% = 100; 10%+ = 0.
  const inventory: HealthComponent = {
    key: "inventory",
    label: "Inventory",
    weight: 15,
    score: inv.wasteRate !== null ? clamp(100 - inv.wasteRate * 10) : inv.itemCount > 0 ? 100 : null,
    detail: inv.wasteRate !== null
      ? `Waste rate ${inv.wasteRate.toFixed(1)}% → 100 − rate × 10`
      : inv.itemCount > 0 ? "No waste recorded in period" : "No inventory tracked",
  };

  // Compliance: agreement (60%) + policy acceptance (40%), minus pending reviews.
  let compScore: number | null = null;
  let compDetail = "No active employees";
  if (comp.activeEmployees > 0) {
    const agreement = comp.agreementRate ?? 0;
    const policy = comp.policyAcceptanceRate ?? (comp.activePolicies === 0 ? 100 : 0);
    compScore = clamp(agreement * 0.6 + policy * 0.4 - comp.pendingTotal * 1.5);
    compDetail = `Agreements ${agreement.toFixed(0)}% ×0.6 + policies ${policy.toFixed(0)}% ×0.4 − pending reviews ×1.5 (${comp.pendingTotal})`;
  }
  const compliance: HealthComponent = { key: "compliance", label: "Compliance", weight: 10, score: compScore, detail: compDetail };

  // Security: deduct for open incidents, alerts and locked accounts.
  const secScore = clamp(
    100 - sec.openSecurityIncidents * 15 - sec.openSecurityAlerts * 8 - sec.lockedUsers * 5 - Math.min(20, sec.failedLogins7d),
  );
  const security: HealthComponent = {
    key: "security",
    label: "Security",
    weight: 10,
    score: secScore,
    detail: `100 − incidents ×15 (${sec.openSecurityIncidents}) − alerts ×8 (${sec.openSecurityAlerts}) − locked ×5 (${sec.lockedUsers}) − failed logins (${Math.min(20, sec.failedLogins7d)})`,
  };

  const components = [finance, operations, workforce, inventory, compliance, security];
  const available = components.filter((c) => c.score !== null);
  const weightSum = available.reduce((s, c) => s + c.weight, 0);
  const total = weightSum > 0
    ? available.reduce((s, c) => s + (c.score ?? 0) * c.weight, 0) / weightSum
    : null;

  return { total, components };
}

// ── Branch directory row (shared by /branches and the dashboard matrix) ──

export interface BranchOverviewRow {
  id: string;
  name: string;
  code: string;
  city: string;
  status: string;
  health: HealthScore;
  revenue: number;
  expenses: number;
  net: number;
  visits: number;
  employees: number;
  attendanceRate: number | null;
  avgWait: number | null;
  reportBacklog: number;
  wasteRate: number | null;
  criticalAlerts: number;
  lastActivity: Date | null;
}

export async function branchOverviews(branchIds: string[], range: Range): Promise<BranchOverviewRow[]> {
  const branches = await db.branch.findMany({
    where: { id: { in: branchIds } },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    branches.map(async (b) => {
      const ids = [b.id];
      const [fin, ops, att, inv, health, criticalAlerts, lastActivity] = await Promise.all([
        financeSummary(ids, range),
        visitStats(ids, range),
        attendanceStats(ids, range),
        inventoryStats(ids, range),
        branchHealth(b.id, range),
        db.alert.count({ where: { branchId: b.id, severity: "CRITICAL", status: { not: "RESOLVED" } } }),
        db.auditEvent.findFirst({
          where: { branchId: b.id, riskLevel: { in: ["MEDIUM", "HIGH"] } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        city: b.city,
        status: b.status,
        health,
        revenue: fin.revenue,
        expenses: fin.expenses,
        net: fin.net,
        visits: ops.total,
        employees: att.activeEmployees,
        attendanceRate: att.rate,
        avgWait: ops.avgWaitMinutes,
        reportBacklog: ops.reportBacklog,
        wasteRate: inv.wasteRate,
        criticalAlerts,
        lastActivity: lastActivity?.createdAt ?? null,
      };
    }),
  );
}
