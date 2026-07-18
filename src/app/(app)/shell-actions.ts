"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser, destroySession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isBranchScoped } from "@/lib/permissions";
import { SCOPE_COOKIE, RANGE_COOKIE } from "@/lib/scope";

export async function setBranchScope(branchId: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (isBranchScoped(user.role)) return; // pinned to own branch
  const store = await cookies();
  if (branchId === "ALL") {
    store.set(SCOPE_COOKIE, "ALL", { path: "/", sameSite: "lax" });
  } else {
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) return;
    store.set(SCOPE_COOKIE, branch.id, { path: "/", sameSite: "lax" });
  }
  revalidatePath("/", "layout");
}

export async function setDateRange(range: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!["7d", "30d", "90d", "month", "year"].includes(range)) return;
  const store = await cookies();
  store.set(RANGE_COOKIE, range, { path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  if (user) {
    await logAudit(user, { action: "auth.logout", resourceType: "Session" });
  }
  await destroySession();
  redirect("/login");
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await db.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}
