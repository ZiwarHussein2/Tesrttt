"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { attemptLogin, getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const result = await attemptLogin(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    await logAudit(null, {
      action: "auth.login",
      resourceType: "Session",
      resourceLabel: parsed.data.email,
      result: "DENIED",
      riskLevel: "MEDIUM",
      reason: result.error,
    });
    return { error: result.error };
  }
  const user = await getSessionUser();
  await logAudit(user, {
    action: "auth.login",
    resourceType: "Session",
    resourceLabel: parsed.data.email,
    result: "SUCCESS",
  });
  redirect("/dashboard");
}
