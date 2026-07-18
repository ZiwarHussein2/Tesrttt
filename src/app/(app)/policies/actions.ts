"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, bool } from "@/lib/form";
import { POLICY_CATEGORIES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

export async function createPolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("policies");
  if (g.error) return g.error;

  const category = str(fd, "category");
  if (!POLICY_CATEGORIES.includes(category as (typeof POLICY_CATEGORIES)[number])) {
    return { error: "Select a valid policy category." };
  }
  const title = str(fd, "title");
  const body = str(fd, "body");
  if (title.length < 3) return { error: "Policy title is required." };
  if (body.length < 20) return { error: "Policy text is required." };

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  const latest = await db.policy.findFirst({ where: { title }, orderBy: { version: "desc" } });

  const policy = await db.policy.create({
    data: {
      companyId: company.id,
      category,
      title,
      version: (latest?.version ?? 0) + 1,
      body,
      status: "DRAFT",
      authorName: g.user.name,
    },
  });

  await logAudit(g.user, {
    action: "policy.create",
    resourceType: "Policy",
    resourceId: policy.id,
    resourceLabel: `${title} v${policy.version}`,
    newValue: { title, category, version: policy.version },
    riskLevel: "MEDIUM",
  });

  revalidatePath("/policies");
  return { success: true };
}

export async function publishPolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("policies");
  if (g.error) return g.error;

  const id = str(fd, "policyId");
  const policy = await db.policy.findUnique({ where: { id } });
  if (!policy) return { error: "Policy not found." };
  if (policy.status !== "DRAFT") return { error: "Only draft policies can be published." };

  await db.$transaction([
    db.policy.updateMany({
      where: { title: policy.title, status: "ACTIVE", id: { not: id } },
      data: { status: "SUPERSEDED", supersededById: id },
    }),
    db.policy.update({
      where: { id },
      data: { status: "ACTIVE", effectiveDate: new Date(), approverName: g.user.name },
    }),
  ]);

  await logAudit(g.user, {
    action: "policy.publish",
    resourceType: "Policy",
    resourceId: id,
    resourceLabel: `${policy.title} v${policy.version}`,
    oldValue: { status: "DRAFT" },
    newValue: { status: "ACTIVE" },
    riskLevel: "HIGH",
  });

  revalidatePath("/policies");
  revalidatePath(`/policies/${id}`);
  return { success: true };
}

export async function recordPolicyAcceptance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("policies");
  if (g.error) return g.error;

  const policyId = str(fd, "policyId");
  const employeeId = str(fd, "employeeId");
  const [policy, employee] = await Promise.all([
    db.policy.findUnique({ where: { id: policyId } }),
    db.employee.findUnique({ where: { id: employeeId } }),
  ]);
  if (!policy || policy.status !== "ACTIVE") return { error: "Policy not found or not active." };
  if (!employee) return { error: "Employee not found." };

  const existing = await db.policyAcceptance.findUnique({
    where: { policyId_employeeId: { policyId, employeeId } },
  });
  if (existing) return { error: "This employee has already accepted this policy version." };

  const acceptance = await db.policyAcceptance.create({
    data: {
      policyId,
      employeeId,
      otpVerified: bool(fd, "otpVerified"),
      deviceRecorded: bool(fd, "deviceRecorded"),
    },
  });

  await logAudit(g.user, {
    action: "policy.acceptance",
    resourceType: "PolicyAcceptance",
    resourceId: acceptance.id,
    resourceLabel: `${policy.title} v${policy.version} — ${employee.firstName} ${employee.lastName}`,
    branchId: employee.branchId,
    newValue: { otpVerified: acceptance.otpVerified, deviceRecorded: acceptance.deviceRecorded },
    riskLevel: "MEDIUM",
  });

  revalidatePath("/policies");
  revalidatePath(`/policies/${policyId}`);
  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

export async function newPolicyVersion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("policies");
  if (g.error) return g.error;

  const id = str(fd, "policyId");
  const policy = await db.policy.findUnique({ where: { id } });
  if (!policy) return { error: "Policy not found." };

  const body = str(fd, "body") || policy.body;
  const draft = await db.policy.create({
    data: {
      companyId: policy.companyId,
      category: policy.category,
      title: policy.title,
      version: policy.version + 1,
      body,
      status: "DRAFT",
      authorName: g.user.name,
    },
  });

  await logAudit(g.user, {
    action: "policy.new-version",
    resourceType: "Policy",
    resourceId: draft.id,
    resourceLabel: `${policy.title} v${draft.version} (draft)`,
    reason: strOrNull(fd, "reason") ?? undefined,
    riskLevel: "MEDIUM",
  });

  revalidatePath("/policies");
  return { success: true };
}
