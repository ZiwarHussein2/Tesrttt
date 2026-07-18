"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/guard";
import { getSessionUser, hashPassword, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { str, strOrNull } from "@/lib/form";
import { ROLES, type Role } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

export async function updateCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("settings");
  if (g.error) return g.error;

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Company name is required." };

  const updated = await db.company.update({
    where: { id: company.id },
    data: {
      name,
      legalName: strOrNull(fd, "legalName") ?? company.legalName,
      registrationNo: strOrNull(fd, "registrationNo"),
      timezone: str(fd, "timezone") || company.timezone,
    },
  });

  await logAudit(g.user, {
    action: "company.update",
    resourceType: "Company",
    resourceId: company.id,
    resourceLabel: updated.name,
    oldValue: { name: company.name, legalName: company.legalName },
    newValue: { name: updated.name, legalName: updated.legalName },
    riskLevel: "HIGH",
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { success: true };
}

const userSchema = z.object({
  name: z.string().min(2, "Full name is required."),
  email: z.string().email("Enter a valid email."),
  role: z.enum(ROLES),
  password: z.string().min(10, "Temporary password must be at least 10 characters."),
});

export async function createUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("settings");
  if (g.error) return g.error;

  const parsed = userSchema.safeParse({
    name: str(fd, "name"),
    email: str(fd, "email").toLowerCase(),
    role: str(fd, "role"),
    password: str(fd, "password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const exists = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) return { error: "An account with this email already exists." };

  const branchId = strOrNull(fd, "branchId");
  if (parsed.data.role === "BRANCH_ADMIN" && !branchId) {
    return { error: "Branch Admin accounts must be assigned to a branch." };
  }
  if (branchId) {
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) return { error: "Branch not found." };
  }

  const employeeId = strOrNull(fd, "employeeId");
  if (employeeId) {
    const linked = await db.user.findFirst({ where: { employeeId } });
    if (linked) return { error: "That employee is already linked to an account." };
  }

  const user = await db.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      branchId: parsed.data.role === "BRANCH_ADMIN" ? branchId : branchId,
      employeeId,
      passwordHash: hashPassword(parsed.data.password),
      mustChangePassword: true,
    },
  });

  await logAudit(g.user, {
    action: "user.create",
    resourceType: "User",
    resourceId: user.id,
    resourceLabel: `${user.name} (${user.email})`,
    branchId: user.branchId,
    newValue: { role: user.role, branchId: user.branchId },
    riskLevel: "HIGH",
  });

  revalidatePath("/settings");
  return { success: true };
}

export async function updateUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("settings");
  if (g.error) return g.error;

  const id = str(fd, "userId");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return { error: "Account not found." };

  const role = str(fd, "role") as Role;
  if (!ROLES.includes(role)) return { error: "Invalid role." };
  const branchId = strOrNull(fd, "branchId");
  if (role === "BRANCH_ADMIN" && !branchId) return { error: "Branch Admin accounts must be assigned to a branch." };

  const active = str(fd, "isActive") === "true";
  if (target.id === g.user.id && (!active || role !== "SUPER_ADMIN")) {
    return { error: "You cannot deactivate or downgrade your own account." };
  }
  if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const supers = await db.user.count({ where: { role: "SUPER_ADMIN", isActive: true } });
    if (supers <= 1) return { error: "At least one active Super Admin must remain." };
  }

  const reason = str(fd, "reason");
  if (!reason) return { error: "A reason is required for account changes." };

  const updated = await db.user.update({
    where: { id },
    data: { role, branchId, isActive: active },
  });

  // Deactivation revokes sessions immediately.
  if (!active) {
    await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  await logAudit(g.user, {
    action: "user.update",
    resourceType: "User",
    resourceId: id,
    resourceLabel: `${updated.name} (${updated.email})`,
    branchId: updated.branchId,
    oldValue: { role: target.role, branchId: target.branchId, isActive: target.isActive },
    newValue: { role, branchId, isActive: active },
    reason,
    riskLevel: "HIGH",
  });

  revalidatePath("/settings");
  return { success: true };
}

export async function resetUserPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("settings");
  if (g.error) return g.error;

  const id = str(fd, "userId");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return { error: "Account not found." };

  const password = str(fd, "password");
  if (password.length < 10) return { error: "Temporary password must be at least 10 characters." };

  await db.user.update({
    where: { id },
    data: { passwordHash: hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  });
  await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

  await logAudit(g.user, {
    action: "user.reset-password",
    resourceType: "User",
    resourceId: id,
    resourceLabel: `${target.name} (${target.email})`,
    riskLevel: "HIGH",
  });

  revalidatePath("/settings");
  return { success: true };
}

// Any authenticated user can change their own password.
export async function changeOwnPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Session expired." };

  const current = str(fd, "currentPassword");
  const next = str(fd, "newPassword");
  if (next.length < 10) return { error: "New password must be at least 10 characters." };

  const record = await db.user.findUnique({ where: { id: user.id } });
  if (!record || !verifyPassword(current, record.passwordHash)) return { error: "Current password is incorrect." };

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(next), mustChangePassword: false },
  });

  await logAudit(user, {
    action: "user.change-password",
    resourceType: "User",
    resourceId: user.id,
    resourceLabel: user.email,
    riskLevel: "MEDIUM",
  });

  return { success: true, message: "Password updated." };
}
