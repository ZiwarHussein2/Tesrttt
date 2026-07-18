"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull } from "@/lib/form";
import { BRANCH_STATUSES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

const branchSchema = z.object({
  name: z.string().min(2, "Branch name is required."),
  code: z.string().min(2, "Branch code is required.").regex(/^[A-Z0-9-]+$/i, "Code: letters, digits and dashes only."),
  city: z.string().min(2, "City is required."),
  status: z.enum(BRANCH_STATUSES),
});

export async function createBranch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("branches");
  if (g.error) return g.error;

  const parsed = branchSchema.safeParse({
    name: str(fd, "name"),
    code: str(fd, "code").toUpperCase(),
    city: str(fd, "city"),
    status: str(fd, "status") || "OPERATING",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  const exists = await db.branch.findUnique({ where: { code: parsed.data.code } });
  if (exists) return { error: `Branch code ${parsed.data.code} is already in use.` };

  const branch = await db.branch.create({
    data: {
      companyId: company.id,
      name: parsed.data.name,
      code: parsed.data.code,
      city: parsed.data.city,
      status: parsed.data.status,
      address: strOrNull(fd, "address"),
      phone: strOrNull(fd, "phone"),
      email: strOrNull(fd, "email"),
      openedAt: new Date(),
    },
  });

  await logAudit(g.user, {
    action: "branch.create",
    resourceType: "Branch",
    resourceId: branch.id,
    resourceLabel: branch.name,
    branchId: branch.id,
    newValue: parsed.data,
    riskLevel: "HIGH",
  });

  revalidatePath("/branches");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateBranch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("branches");
  if (g.error) return g.error;

  const id = str(fd, "branchId");
  const existing = await db.branch.findUnique({ where: { id } });
  if (!existing) return { error: "Branch not found." };

  const parsed = branchSchema.safeParse({
    name: str(fd, "name"),
    code: str(fd, "code").toUpperCase(),
    city: str(fd, "city"),
    status: str(fd, "status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const codeClash = await db.branch.findFirst({ where: { code: parsed.data.code, id: { not: id } } });
  if (codeClash) return { error: `Branch code ${parsed.data.code} is already in use.` };

  const updated = await db.branch.update({
    where: { id },
    data: {
      name: parsed.data.name,
      code: parsed.data.code,
      city: parsed.data.city,
      status: parsed.data.status,
      address: strOrNull(fd, "address"),
      phone: strOrNull(fd, "phone"),
      email: strOrNull(fd, "email"),
    },
  });

  await logAudit(g.user, {
    action: "branch.update",
    resourceType: "Branch",
    resourceId: id,
    resourceLabel: updated.name,
    branchId: id,
    oldValue: { name: existing.name, code: existing.code, city: existing.city, status: existing.status },
    newValue: parsed.data,
    riskLevel: "HIGH",
    reason: strOrNull(fd, "reason") ?? undefined,
  });

  revalidatePath("/branches");
  revalidatePath(`/branches/${id}`);
  revalidatePath("/", "layout");
  return { success: true };
}
