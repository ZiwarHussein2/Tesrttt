"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed, resolveBranchId } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num, dateOrNull, isValidTime } from "@/lib/form";
import { EMPLOYMENT_STATUSES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

async function nextEmployeeCode(): Promise<string> {
  const count = await db.employee.count();
  let n = count + 1;
  // Ensure uniqueness even after deletions/imports.
  for (;;) {
    const code = `EMP-${String(n).padStart(4, "0")}`;
    const exists = await db.employee.findUnique({ where: { employeeCode: code } });
    if (!exists) return code;
    n += 1;
  }
}

const employeeSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  jobTitle: z.string().min(2, "Job title is required."),
  branchId: z.string().min(1, "Branch is required."),
});

export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("employees");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  const parsed = employeeSchema.safeParse({
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    jobTitle: str(fd, "jobTitle"),
    branchId: branchId ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };

  const branch = await db.branch.findUnique({ where: { id: branchId! } });
  if (!branch) return { error: "Branch not found." };

  const departmentId = strOrNull(fd, "departmentId");
  if (departmentId) {
    const dep = await db.department.findUnique({ where: { id: departmentId } });
    if (!dep || dep.branchId !== branchId) return { error: "Department must belong to the selected branch." };
  }

  const scheduleStart = str(fd, "workScheduleStart") || "08:30";
  const scheduleEnd = str(fd, "workScheduleEnd") || "17:00";
  if (!isValidTime(scheduleStart) || !isValidTime(scheduleEnd)) return { error: "Schedule times must be HH:MM (24h)." };

  const employee = await db.employee.create({
    data: {
      companyId: branch.companyId,
      branchId: branch.id,
      departmentId,
      employeeCode: await nextEmployeeCode(),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      jobTitle: parsed.data.jobTitle,
      email: strOrNull(fd, "email"),
      phone: strOrNull(fd, "phone"),
      startDate: dateOrNull(fd, "startDate") ?? new Date(),
      baseSalary: num(fd, "baseSalary", 0),
      workScheduleStart: scheduleStart,
      workScheduleEnd: scheduleEnd,
    },
  });

  await logAudit(g.user, {
    action: "employee.create",
    resourceType: "Employee",
    resourceId: employee.id,
    resourceLabel: `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
    branchId: branch.id,
    departmentId,
    newValue: { name: `${employee.firstName} ${employee.lastName}`, jobTitle: employee.jobTitle, branch: branch.name },
    riskLevel: "MEDIUM",
  });

  revalidatePath("/employees");
  return { success: true };
}

export async function updateEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("employees");
  if (g.error) return g.error;

  const id = str(fd, "employeeId");
  const existing = await db.employee.findUnique({ where: { id } });
  if (!existing) return { error: "Employee not found." };
  if (!branchAllowed(g.user, existing.branchId)) return { error: "You cannot modify another branch." };

  const status = str(fd, "employmentStatus") || existing.employmentStatus;
  if (!EMPLOYMENT_STATUSES.includes(status as (typeof EMPLOYMENT_STATUSES)[number])) {
    return { error: "Invalid employment status." };
  }
  const jobTitle = str(fd, "jobTitle") || existing.jobTitle;
  const baseSalary = num(fd, "baseSalary", existing.baseSalary);
  const scheduleStart = str(fd, "workScheduleStart") || existing.workScheduleStart;
  const scheduleEnd = str(fd, "workScheduleEnd") || existing.workScheduleEnd;
  if (!isValidTime(scheduleStart) || !isValidTime(scheduleEnd)) return { error: "Schedule times must be HH:MM (24h)." };
  const reason = str(fd, "reason");
  if (!reason) return { error: "A reason is required — recorded in the audit log." };

  const departmentId = strOrNull(fd, "departmentId");
  if (departmentId) {
    const dep = await db.department.findUnique({ where: { id: departmentId } });
    if (!dep || dep.branchId !== existing.branchId) return { error: "Department must belong to the employee's branch." };
  }

  const salaryChanged = baseSalary !== existing.baseSalary;
  const updated = await db.employee.update({
    where: { id },
    data: {
      jobTitle,
      employmentStatus: status,
      baseSalary,
      departmentId,
      email: strOrNull(fd, "email") ?? existing.email,
      phone: strOrNull(fd, "phone") ?? existing.phone,
      workScheduleStart: scheduleStart,
      workScheduleEnd: scheduleEnd,
      endDate: status === "TERMINATED" ? new Date() : existing.endDate,
    },
  });

  await logAudit(g.user, {
    action: salaryChanged ? "employee.update-compensation" : "employee.update",
    resourceType: "Employee",
    resourceId: id,
    resourceLabel: `${updated.firstName} ${updated.lastName} (${updated.employeeCode})`,
    branchId: existing.branchId,
    departmentId: updated.departmentId,
    oldValue: {
      jobTitle: existing.jobTitle, status: existing.employmentStatus,
      baseSalary: existing.baseSalary, departmentId: existing.departmentId,
      schedule: `${existing.workScheduleStart}-${existing.workScheduleEnd}`,
    },
    newValue: {
      jobTitle, status, baseSalary, departmentId,
      schedule: `${scheduleStart}-${scheduleEnd}`,
    },
    reason,
    riskLevel: salaryChanged || status !== existing.employmentStatus ? "HIGH" : "MEDIUM",
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  return { success: true };
}
