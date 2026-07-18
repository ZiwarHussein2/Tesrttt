"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed, resolveBranchId } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num, dateOrNull } from "@/lib/form";
import {
  EXPENSE_CATEGORIES, EMPLOYEE_EXPENSE_CATEGORIES, PAYMENT_METHODS,
} from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

function revalidateFinance() {
  revalidatePath("/finance");
  revalidatePath("/finance/income");
  revalidatePath("/finance/expenses");
  revalidatePath("/finance/employee-expenses");
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/budgets");
  revalidatePath("/finance/discounts");
  revalidatePath("/dashboard");
}

// ── Income (manual entries: other income; patient income is created by payments) ──

export async function createIncomeEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.income");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  if (!branchId) return { error: "Branch is required." };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };
  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) return { error: "Branch not found." };

  const amount = num(fd, "amount", -1);
  if (amount <= 0) return { error: "Amount must be greater than zero." };
  const method = str(fd, "method") || "CASH";
  if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) return { error: "Invalid payment method." };
  const description = str(fd, "description");
  if (!description) return { error: "A description is required." };

  const departmentId = strOrNull(fd, "departmentId");
  if (departmentId) {
    const dep = await db.department.findUnique({ where: { id: departmentId } });
    if (!dep || dep.branchId !== branchId) return { error: "Department must belong to the selected branch." };
  }

  const entry = await db.incomeEntry.create({
    data: {
      branchId,
      departmentId,
      category: "OTHER",
      description,
      amount,
      method,
      receivedAt: dateOrNull(fd, "receivedAt") ?? new Date(),
      recordedByName: g.user.name,
    },
  });

  await logAudit(g.user, {
    action: "income.create",
    resourceType: "IncomeEntry",
    resourceId: entry.id,
    resourceLabel: description,
    branchId,
    departmentId,
    newValue: { amount, method, description },
    riskLevel: "MEDIUM",
  });

  revalidateFinance();
  return { success: true };
}

// ── Expenses ──

async function expenseAnomalyScore(branchId: string, category: string, amount: number, expenseDate: Date): Promise<number> {
  const history = await db.expense.aggregate({
    where: { branchId, category, status: "APPROVED" },
    _avg: { amount: true },
    _count: { id: true },
  });
  let score = 0;
  const avg = history._avg.amount ?? 0;
  if (history._count.id >= 3 && avg > 0) {
    score += Math.min(6, Math.max(0, amount / avg - 1)); // how many multiples above average
  }
  const day = expenseDate.getDay();
  if (day === 5 || day === 6) score += 1; // weekend entry (Fri/Sat)
  return Math.round(score * 100) / 100;
}

export async function createExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.expenses");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  if (!branchId) return { error: "Branch is required." };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };

  const category = str(fd, "category");
  if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) return { error: "Select a valid category." };
  const amount = num(fd, "amount", -1);
  if (amount <= 0) return { error: "Amount must be greater than zero." };
  const description = str(fd, "description");
  if (!description) return { error: "A description is required." };
  const expenseDate = dateOrNull(fd, "expenseDate") ?? new Date();

  const departmentId = strOrNull(fd, "departmentId");
  if (departmentId) {
    const dep = await db.department.findUnique({ where: { id: departmentId } });
    if (!dep || dep.branchId !== branchId) return { error: "Department must belong to the selected branch." };
  }

  const anomalyScore = await expenseAnomalyScore(branchId, category, amount, expenseDate);

  const expense = await db.expense.create({
    data: {
      branchId,
      departmentId,
      category,
      vendor: strOrNull(fd, "vendor"),
      description,
      amount,
      expenseDate,
      paymentMethod: str(fd, "paymentMethod") || "CASH",
      submittedById: g.user.id,
      submittedByName: g.user.name,
      anomalyScore,
      notes: strOrNull(fd, "notes"),
    },
  });

  await logAudit(g.user, {
    action: "expense.submit",
    resourceType: "Expense",
    resourceId: expense.id,
    resourceLabel: description,
    branchId,
    departmentId,
    newValue: { category, amount, vendor: expense.vendor, anomalyScore },
    riskLevel: anomalyScore >= 3 ? "HIGH" : "LOW",
  });

  revalidateFinance();
  return { success: true };
}

export async function reviewExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.expenses");
  if (g.error) return g.error;

  const id = str(fd, "expenseId");
  const decision = str(fd, "decision"); // APPROVED | REJECTED | UNDER_REVIEW
  if (!["APPROVED", "REJECTED", "UNDER_REVIEW"].includes(decision)) return { error: "Invalid decision." };

  const expense = await db.expense.findUnique({ where: { id } });
  if (!expense) return { error: "Expense not found." };
  if (!branchAllowed(g.user, expense.branchId)) return { error: "You cannot modify another branch." };
  if (expense.status === "APPROVED" && decision === "APPROVED") return { error: "Already approved." };
  if (expense.submittedById === g.user.id && decision === "APPROVED" && g.user.role !== "SUPER_ADMIN") {
    return { error: "Segregation of duties: you cannot approve an expense you submitted yourself." };
  }

  const reason = strOrNull(fd, "reason");
  if (decision === "REJECTED" && !reason) return { error: "A reason is required to reject." };

  await db.expense.update({
    where: { id },
    data: {
      status: decision,
      reviewedById: g.user.id,
      reviewedByName: g.user.name,
      notes: reason ?? expense.notes,
    },
  });

  await logAudit(g.user, {
    action: `expense.${decision.toLowerCase().replace("_", "-")}`,
    resourceType: "Expense",
    resourceId: id,
    resourceLabel: expense.description,
    branchId: expense.branchId,
    departmentId: expense.departmentId,
    oldValue: { status: expense.status },
    newValue: { status: decision, amount: expense.amount },
    reason: reason ?? undefined,
    riskLevel: expense.amount > 5_000_000 || expense.anomalyScore >= 3 ? "HIGH" : "MEDIUM",
  });

  revalidateFinance();
  return { success: true };
}

// ── Employee expenses ──

export async function createEmployeeExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.employee-expenses");
  if (g.error) return g.error;

  const employeeId = str(fd, "employeeId");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { error: "Employee not found." };
  if (!branchAllowed(g.user, employee.branchId)) return { error: "You cannot modify another branch." };

  const category = str(fd, "category");
  if (!EMPLOYEE_EXPENSE_CATEGORIES.includes(category as (typeof EMPLOYEE_EXPENSE_CATEGORIES)[number])) {
    return { error: "Select a valid category." };
  }
  const amount = num(fd, "amount", -1);
  if (amount <= 0) return { error: "Amount must be greater than zero." };
  const description = str(fd, "description");
  if (!description) return { error: "A description is required." };
  const expenseDate = dateOrNull(fd, "expenseDate") ?? new Date();

  // Duplicate heuristic: same employee, category and amount within 3 days.
  const nearby = await db.employeeExpense.count({
    where: {
      employeeId,
      category,
      amount,
      expenseDate: {
        gte: new Date(expenseDate.getTime() - 3 * 86400000),
        lte: new Date(expenseDate.getTime() + 3 * 86400000),
      },
    },
  });
  // Anomaly heuristic: > 3× the employee's historical average claim.
  const hist = await db.employeeExpense.aggregate({ where: { employeeId }, _avg: { amount: true }, _count: { id: true } });
  const anomalyFlag = hist._count.id >= 3 && (hist._avg.amount ?? 0) > 0 && amount > 3 * (hist._avg.amount ?? 0);

  const claim = await db.employeeExpense.create({
    data: {
      employeeId,
      branchId: employee.branchId,
      category,
      description,
      amount,
      expenseDate,
      duplicateFlag: nearby > 0,
      anomalyFlag,
    },
  });

  await logAudit(g.user, {
    action: "employee-expense.submit",
    resourceType: "EmployeeExpense",
    resourceId: claim.id,
    resourceLabel: `${employee.firstName} ${employee.lastName} — ${description}`,
    branchId: employee.branchId,
    newValue: { category, amount, duplicateFlag: claim.duplicateFlag, anomalyFlag },
    riskLevel: claim.duplicateFlag || anomalyFlag ? "MEDIUM" : "LOW",
  });

  revalidateFinance();
  return { success: true };
}

export async function reviewEmployeeExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.employee-expenses");
  if (g.error) return g.error;

  const id = str(fd, "claimId");
  const decision = str(fd, "decision"); // APPROVED | REJECTED | REIMBURSED
  if (!["APPROVED", "REJECTED", "REIMBURSED"].includes(decision)) return { error: "Invalid decision." };

  const claim = await db.employeeExpense.findUnique({ where: { id }, include: { employee: true } });
  if (!claim) return { error: "Claim not found." };
  if (!branchAllowed(g.user, claim.branchId)) return { error: "You cannot modify another branch." };

  const reason = strOrNull(fd, "reason");
  if (decision === "REJECTED" && !reason) return { error: "A reason is required to reject." };
  if (decision === "REIMBURSED" && claim.status !== "APPROVED") return { error: "Only approved claims can be reimbursed." };

  await db.employeeExpense.update({
    where: { id },
    data: { status: decision, reviewedByName: g.user.name },
  });

  // Reimbursement becomes a real expense so finance reconciles.
  if (decision === "REIMBURSED") {
    await db.expense.create({
      data: {
        branchId: claim.branchId,
        category: "REIMBURSEMENTS",
        description: `Reimbursement — ${claim.employee.firstName} ${claim.employee.lastName}: ${claim.description}`,
        amount: claim.amount,
        expenseDate: new Date(),
        paymentMethod: "CASH",
        submittedById: g.user.id,
        submittedByName: g.user.name,
        reviewedById: g.user.id,
        reviewedByName: g.user.name,
        status: "APPROVED",
      },
    });
  }

  await logAudit(g.user, {
    action: `employee-expense.${decision.toLowerCase()}`,
    resourceType: "EmployeeExpense",
    resourceId: id,
    resourceLabel: claim.description,
    branchId: claim.branchId,
    oldValue: { status: claim.status },
    newValue: { status: decision, amount: claim.amount },
    reason: reason ?? undefined,
    riskLevel: "MEDIUM",
  });

  revalidateFinance();
  return { success: true };
}

// ── Payroll ──

export async function generatePayrollRun(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.payroll");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  if (!branchId) return { error: "Branch is required." };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };
  const period = str(fd, "period"); // YYYY-MM
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { error: "Period must be YYYY-MM." };

  const existing = await db.payrollRun.findUnique({ where: { branchId_period: { branchId, period } } });
  if (existing) return { error: `A payroll run for ${period} already exists for this branch.` };

  const employees = await db.employee.findMany({ where: { branchId, employmentStatus: "ACTIVE" } });
  if (employees.length === 0) return { error: "No active employees in this branch." };

  const [y, m] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));

  const attendance = await db.attendanceRecord.findMany({
    where: { branchId, date: { gte: from, lt: to } },
    select: { employeeId: true, status: true, overtimeMinutes: true },
  });
  const approvedClaims = await db.employeeExpense.findMany({
    where: { branchId, status: "APPROVED", expenseDate: { gte: from, lt: to } },
    select: { employeeId: true, amount: true },
  });

  const run = await db.payrollRun.create({
    data: { branchId, period, createdByName: g.user.name },
  });

  const WORK_DAYS = 22;
  const items = employees.map((e) => {
    const att = attendance.filter((a) => a.employeeId === e.id);
    const absences = att.filter((a) => a.status === "ABSENT").length;
    const otMinutes = att.reduce((s, a) => s + a.overtimeMinutes, 0);
    const hourly = e.baseSalary > 0 ? e.baseSalary / (WORK_DAYS * 8) : 0;
    const overtimeAmount = Math.round((otMinutes / 60) * hourly);
    const attendanceDeductions = Math.round(absences * (e.baseSalary / WORK_DAYS));
    const reimbursements = approvedClaims.filter((c) => c.employeeId === e.id).reduce((s, c) => s + c.amount, 0);
    const netAmount = e.baseSalary + overtimeAmount - attendanceDeductions + reimbursements;
    return {
      payrollRunId: run.id,
      employeeId: e.id,
      baseSalary: e.baseSalary,
      overtimeAmount,
      attendanceDeductions,
      reimbursements,
      netAmount,
    };
  });
  await db.payrollItem.createMany({ data: items });

  await logAudit(g.user, {
    action: "payroll.generate",
    resourceType: "PayrollRun",
    resourceId: run.id,
    resourceLabel: `Payroll ${period}`,
    branchId,
    newValue: {
      period,
      employees: employees.length,
      total: items.reduce((s, i) => s + i.netAmount, 0),
    },
    riskLevel: "HIGH",
  });

  revalidateFinance();
  return { success: true };
}

export async function setPayrollStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.payroll");
  if (g.error) return g.error;

  const id = str(fd, "runId");
  const status = str(fd, "status"); // APPROVED | PAID
  if (!["APPROVED", "PAID"].includes(status)) return { error: "Invalid status." };

  const run = await db.payrollRun.findUnique({ where: { id }, include: { items: true } });
  if (!run) return { error: "Payroll run not found." };
  if (!branchAllowed(g.user, run.branchId)) return { error: "You cannot modify another branch." };
  if (status === "APPROVED" && run.status !== "DRAFT") return { error: "Only draft runs can be approved." };
  if (status === "PAID" && run.status !== "APPROVED") return { error: "Only approved runs can be marked paid." };

  await db.payrollRun.update({
    where: { id },
    data: { status, approvedByName: status === "APPROVED" ? g.user.name : run.approvedByName },
  });

  // Payment creates the matching approved expenses so finance reconciles.
  if (status === "PAID") {
    const base = run.items.reduce((s, i) => s + i.baseSalary - i.attendanceDeductions + i.bonuses - i.deductions, 0);
    const overtime = run.items.reduce((s, i) => s + i.overtimeAmount, 0);
    const now = new Date();
    const rows = [
      { category: "SALARIES", amount: base, label: `Payroll ${run.period} — salaries` },
      { category: "OVERTIME", amount: overtime, label: `Payroll ${run.period} — overtime` },
    ].filter((r) => r.amount > 0);
    for (const r of rows) {
      await db.expense.create({
        data: {
          branchId: run.branchId,
          category: r.category,
          description: r.label,
          amount: r.amount,
          expenseDate: now,
          paymentMethod: "TRANSFER",
          submittedById: g.user.id,
          submittedByName: g.user.name,
          reviewedById: g.user.id,
          reviewedByName: g.user.name,
          status: "APPROVED",
        },
      });
    }
  }

  await logAudit(g.user, {
    action: `payroll.${status.toLowerCase()}`,
    resourceType: "PayrollRun",
    resourceId: id,
    resourceLabel: `Payroll ${run.period}`,
    branchId: run.branchId,
    oldValue: { status: run.status },
    newValue: { status, total: run.items.reduce((s, i) => s + i.netAmount, 0) },
    riskLevel: "HIGH",
  });

  revalidateFinance();
  return { success: true };
}

// ── Budgets ──

export async function setBudget(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.budgets");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  if (!branchId) return { error: "Branch is required." };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };
  const period = str(fd, "period");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { error: "Period must be YYYY-MM." };
  const amount = num(fd, "amount", -1);
  if (amount < 0) return { error: "Enter a valid amount." };
  const rawCategory = strOrNull(fd, "category");
  const category = rawCategory && EXPENSE_CATEGORIES.includes(rawCategory as (typeof EXPENSE_CATEGORIES)[number]) ? rawCategory : null;

  const existing = await db.budget.findFirst({ where: { branchId, period, category } });
  const budget = existing
    ? await db.budget.update({ where: { id: existing.id }, data: { amount } })
    : await db.budget.create({ data: { branchId, period, category, amount } });

  await logAudit(g.user, {
    action: existing ? "budget.update" : "budget.create",
    resourceType: "Budget",
    resourceId: budget.id,
    resourceLabel: `${period}${category ? ` · ${category}` : " · total"}`,
    branchId,
    oldValue: existing ? { amount: existing.amount } : undefined,
    newValue: { amount },
    riskLevel: "MEDIUM",
  });

  revalidateFinance();
  return { success: true };
}

// ── Discounts ──

export async function requestDiscount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.discounts");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  if (!branchId) return { error: "Branch is required." };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };

  const oldPrice = num(fd, "oldPrice", -1);
  const newPrice = num(fd, "newPrice", -1);
  if (oldPrice <= 0) return { error: "Enter the current price." };
  if (newPrice < 0 || newPrice >= oldPrice) return { error: "New price must be lower than the current price." };
  const reason = str(fd, "reason");
  if (!reason) return { error: "A reason is required for every discount request." };

  const visitId = strOrNull(fd, "visitId");
  if (visitId) {
    const visit = await db.visit.findUnique({ where: { id: visitId } });
    if (!visit || visit.branchId !== branchId) return { error: "Visit not found in this branch." };
  }

  const request = await db.discountRequest.create({
    data: {
      branchId,
      departmentId: strOrNull(fd, "departmentId"),
      visitId,
      type: "MANUAL",
      oldPrice,
      newPrice,
      reason,
      requestedByName: g.user.name,
    },
  });

  await logAudit(g.user, {
    action: "discount.request",
    resourceType: "DiscountRequest",
    resourceId: request.id,
    resourceLabel: `${oldPrice} → ${newPrice}`,
    branchId,
    newValue: { oldPrice, newPrice, reason },
    riskLevel: "MEDIUM",
  });

  revalidateFinance();
  revalidatePath("/queues");
  return { success: true };
}

export async function decideDiscount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.discounts");
  if (g.error) return g.error;

  const id = str(fd, "requestId");
  const decision = str(fd, "decision"); // APPROVED | REJECTED
  if (!["APPROVED", "REJECTED"].includes(decision)) return { error: "Invalid decision." };

  const request = await db.discountRequest.findUnique({ where: { id }, include: { visit: true } });
  if (!request) return { error: "Discount request not found." };
  if (!branchAllowed(g.user, request.branchId)) return { error: "You cannot modify another branch." };
  if (request.status !== "PENDING") return { error: "This request has already been decided." };
  if (request.requestedByName === g.user.name && decision === "APPROVED" && g.user.role !== "SUPER_ADMIN") {
    return { error: "Segregation of duties: you cannot approve your own discount request." };
  }

  const reason = strOrNull(fd, "reason");
  if (decision === "REJECTED" && !reason) return { error: "A reason is required to reject." };

  await db.$transaction(async (tx) => {
    await tx.discountRequest.update({
      where: { id },
      data: { status: decision, reviewedByName: g.user.name, decidedAt: new Date() },
    });
    // Apply to the linked visit if it hasn't been fully paid yet.
    if (decision === "APPROVED" && request.visitId && request.visit && request.visit.paymentStatus !== "PAID") {
      await tx.visit.update({
        where: { id: request.visitId },
        data: {
          discountAmount: request.oldPrice - request.newPrice,
          price: request.oldPrice,
        },
      });
    }
  });

  await logAudit(g.user, {
    action: `discount.${decision.toLowerCase()}`,
    resourceType: "DiscountRequest",
    resourceId: id,
    resourceLabel: `${request.oldPrice} → ${request.newPrice}`,
    branchId: request.branchId,
    oldValue: { status: "PENDING" },
    newValue: { status: decision },
    reason: reason ?? request.reason,
    riskLevel: "HIGH",
  });

  revalidateFinance();
  revalidatePath("/queues");
  return { success: true };
}

export async function createDiscountCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.discounts");
  if (g.error) return g.error;

  const code = str(fd, "code").toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) return { error: "Code: 3-24 letters, digits or dashes." };
  const percent = num(fd, "percent", 0);
  const amount = num(fd, "amount", 0);
  if (percent <= 0 && amount <= 0) return { error: "Set a percentage or a fixed amount." };
  if (percent > 100) return { error: "Percentage cannot exceed 100." };

  const exists = await db.discountCode.findUnique({ where: { code } });
  if (exists) return { error: `Code ${code} already exists.` };

  const dc = await db.discountCode.create({
    data: {
      code,
      percent: percent > 0 ? percent : null,
      amount: amount > 0 ? amount : null,
      maxUses: num(fd, "maxUses", 0) > 0 ? num(fd, "maxUses", 0) : null,
      validFrom: dateOrNull(fd, "validFrom"),
      validTo: dateOrNull(fd, "validTo"),
      createdByName: g.user.name,
    },
  });

  await logAudit(g.user, {
    action: "discount-code.create",
    resourceType: "DiscountCode",
    resourceId: dc.id,
    resourceLabel: code,
    newValue: { code, percent: dc.percent, amount: dc.amount, maxUses: dc.maxUses },
    riskLevel: "HIGH",
  });

  revalidateFinance();
  return { success: true };
}

export async function toggleDiscountCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("finance.discounts");
  if (g.error) return g.error;

  const id = str(fd, "codeId");
  const dc = await db.discountCode.findUnique({ where: { id } });
  if (!dc) return { error: "Code not found." };

  await db.discountCode.update({ where: { id }, data: { active: !dc.active } });

  await logAudit(g.user, {
    action: dc.active ? "discount-code.deactivate" : "discount-code.activate",
    resourceType: "DiscountCode",
    resourceId: id,
    resourceLabel: dc.code,
    oldValue: { active: dc.active },
    newValue: { active: !dc.active },
    riskLevel: "MEDIUM",
  });

  revalidateFinance();
  return { success: true };
}
