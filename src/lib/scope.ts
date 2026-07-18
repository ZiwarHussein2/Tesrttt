import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { isBranchScoped } from "@/lib/permissions";

// Global UI scope: which branch(es) and which date range the user is viewing.
// Persisted in cookies so it survives navigation; BRANCH_ADMIN is always
// pinned to their own branch regardless of the cookie.

export const SCOPE_COOKIE = "mcc_scope";
export const RANGE_COOKIE = "mcc_range";

export type RangeKey = "7d" | "30d" | "90d" | "month" | "year";

export interface Scope {
  branchId: string | null; // null = all branches
  branchIds: string[]; // resolved list of branch ids in scope
  branchName: string | null;
  range: RangeKey;
  from: Date;
  to: Date;
  prevFrom: Date; // matching previous period for comparisons
  prevTo: Date;
}

export function rangeBounds(range: RangeKey): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const now = new Date();
  const to = now;
  let from: Date;
  if (range === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevTo = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to, prevFrom, prevTo };
  }
  if (range === "year") {
    from = new Date(now.getFullYear(), 0, 1);
    const prevFrom = new Date(now.getFullYear() - 1, 0, 1);
    const prevTo = new Date(now.getFullYear(), 0, 1);
    return { from, to, prevFrom, prevTo };
  }
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to, prevFrom, prevTo: from };
}

export const getScope = cache(async (user: SessionUser): Promise<Scope> => {
  const store = await cookies();
  const rawRange = (store.get(RANGE_COOKIE)?.value as RangeKey) || "30d";
  const range: RangeKey = ["7d", "30d", "90d", "month", "year"].includes(rawRange) ? rawRange : "30d";
  const bounds = rangeBounds(range);

  const allBranches = await db.branch.findMany({ select: { id: true, name: true } });

  let branchId: string | null = null;
  if (isBranchScoped(user.role)) {
    branchId = user.branchId;
  } else {
    const raw = store.get(SCOPE_COOKIE)?.value;
    if (raw && raw !== "ALL" && allBranches.some((b) => b.id === raw)) branchId = raw;
  }

  const branchIds = branchId ? [branchId] : allBranches.map((b) => b.id);
  const branchName = branchId ? allBranches.find((b) => b.id === branchId)?.name ?? null : null;

  return { branchId, branchIds, branchName, range, ...bounds };
});

// Prisma `where` fragment for branch scoping.
export function branchWhere(scope: Scope): { branchId?: { in: string[] } | string } {
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}
