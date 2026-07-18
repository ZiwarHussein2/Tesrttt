import "server-only";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { canWrite, isBranchScoped, type ModuleKey } from "@/lib/permissions";
import type { ActionState } from "@/lib/action-state";

// Guard for mutating server actions: authenticated + write access on module.
// Returns either the user or an ActionState error to surface in the form.
export async function guardWrite(
  module: ModuleKey,
): Promise<{ user: SessionUser; error?: never } | { user?: never; error: ActionState }> {
  const user = await getSessionUser();
  if (!user) return { error: { error: "Your session has expired. Sign in again." } };
  if (!canWrite(user.role, module)) {
    return { error: { error: "Your role does not have permission for this action." } };
  }
  return { user };
}

// For BRANCH_ADMIN, force the target branch to their own branch.
export function resolveBranchId(user: SessionUser, requested: string | null): string | null {
  if (isBranchScoped(user.role)) return user.branchId;
  return requested;
}

// Branch-scoped users may only touch records in their own branch.
export function branchAllowed(user: SessionUser, branchId: string | null | undefined): boolean {
  if (!isBranchScoped(user.role)) return true;
  return !!branchId && branchId === user.branchId;
}
