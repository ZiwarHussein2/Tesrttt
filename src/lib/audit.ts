import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import type { RiskLevel } from "@/types/enums";

export interface AuditInput {
  action: string; // e.g. "expense.approve"
  resourceType: string; // e.g. "Expense"
  resourceId?: string;
  resourceLabel?: string;
  branchId?: string | null;
  departmentId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  result?: "SUCCESS" | "DENIED" | "FAILURE";
  riskLevel?: RiskLevel;
  correlationId?: string;
}

// Append-only audit trail. There is intentionally no update/delete API.
export async function logAudit(user: SessionUser | null, input: AuditInput): Promise<void> {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  } catch {
    // headers() unavailable outside a request context
  }
  await db.auditEvent.create({
    data: {
      userId: user?.id ?? null,
      userName: user?.name ?? "System",
      role: user?.role ?? "SYSTEM",
      branchId: input.branchId ?? null,
      departmentId: input.departmentId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceLabel: input.resourceLabel,
      oldValue: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      newValue: input.newValue === undefined ? null : JSON.stringify(input.newValue),
      reason: input.reason,
      result: input.result ?? "SUCCESS",
      riskLevel: input.riskLevel ?? "LOW",
      ip,
      correlationId: input.correlationId,
    },
  });
}
