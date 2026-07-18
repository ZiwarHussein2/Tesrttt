"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, createSession, getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const setupSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required."),
  legalName: z.string().trim().optional(),
  adminName: z.string().trim().min(2, "Your full name is required."),
  email: z.string().email("Enter a valid email address."),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters.")
    .regex(/[a-z]/, "Password must include a lowercase letter.")
    .regex(/[A-Z0-9]/, "Password must include an uppercase letter or digit."),
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export interface SetupState {
  error?: string;
}

export async function setupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  // Hard guard: setup is only possible while the system has no users at all.
  const userCount = await db.user.count();
  if (userCount > 0) redirect("/login");

  const parsed = setupSchema.safeParse({
    companyName: formData.get("companyName"),
    legalName: formData.get("legalName") || undefined,
    adminName: formData.get("adminName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const company = await db.company.create({
    data: {
      name: data.companyName,
      legalName: data.legalName || data.companyName,
    },
  });
  const admin = await db.user.create({
    data: {
      email: data.email.toLowerCase().trim(),
      passwordHash: hashPassword(data.password),
      name: data.adminName,
      role: "SUPER_ADMIN",
    },
  });

  await createSession(admin.id);
  const user = await getSessionUser();
  await logAudit(user, {
    action: "system.setup",
    resourceType: "Company",
    resourceId: company.id,
    resourceLabel: company.name,
    newValue: { company: company.name, admin: admin.email },
    riskLevel: "HIGH",
    reason: "Initial system setup",
  });

  redirect("/dashboard");
}
