"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull } from "@/lib/form";
import { maybeRunAlertScan } from "@/lib/analytics/alerts";
import { ALERT_CATEGORIES, ALERT_SEVERITIES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

export async function runAlertScan(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const g = await guardWrite("alerts");
  if (g.error) return g.error;
  const result = await maybeRunAlertScan(true);
  await logAudit(g.user, {
    action: "alerts.scan",
    resourceType: "Alert",
    newValue: { created: result.created, autoResolved: result.autoResolved },
    riskLevel: "LOW",
  });
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function createManualAlert(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("alerts");
  if (g.error) return g.error;

  const title = str(fd, "title");
  const description = str(fd, "description");
  if (title.length < 5) return { error: "Alert title is required." };
  if (description.length < 5) return { error: "Describe the issue." };
  const category = str(fd, "category");
  if (!ALERT_CATEGORIES.includes(category as (typeof ALERT_CATEGORIES)[number])) return { error: "Select a category." };
  const severity = str(fd, "severity");
  if (!ALERT_SEVERITIES.includes(severity as (typeof ALERT_SEVERITIES)[number])) return { error: "Select a severity." };

  const branchId = strOrNull(fd, "branchId");
  if (branchId && !branchAllowed(g.user, branchId)) return { error: "You cannot raise alerts for another branch." };

  const alert = await db.alert.create({
    data: { title, description, category, severity, branchId, source: "MANUAL", ownerName: g.user.name },
  });

  await logAudit(g.user, {
    action: "alert.create",
    resourceType: "Alert",
    resourceId: alert.id,
    resourceLabel: title,
    branchId,
    newValue: { category, severity },
    riskLevel: severity === "CRITICAL" ? "HIGH" : "MEDIUM",
  });

  revalidatePath("/alerts");
  return { success: true };
}

export async function alertAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("alerts");
  if (g.error) return g.error;

  const id = str(fd, "alertId");
  const kind = str(fd, "kind"); // acknowledge | assign | note | resolve | reopen
  const alert = await db.alert.findUnique({ where: { id } });
  if (!alert) return { error: "Alert not found." };
  if (alert.branchId && !branchAllowed(g.user, alert.branchId)) return { error: "You cannot manage another branch's alerts." };

  const note = strOrNull(fd, "reason");
  const appendNote = (extra: string) => (alert.notes ? alert.notes + "\n" : "") + extra;

  switch (kind) {
    case "acknowledge":
      if (alert.status !== "OPEN") return { error: "Only open alerts can be acknowledged." };
      await db.alert.update({ where: { id }, data: { status: "ACKNOWLEDGED", ownerName: alert.ownerName ?? g.user.name } });
      break;
    case "assign": {
      const owner = str(fd, "owner") || g.user.name;
      await db.alert.update({ where: { id }, data: { ownerName: owner, status: alert.status === "OPEN" ? "ACKNOWLEDGED" : alert.status } });
      break;
    }
    case "note":
      if (!note) return { error: "Enter a note." };
      await db.alert.update({ where: { id }, data: { notes: appendNote(`${g.user.name}: ${note}`) } });
      break;
    case "resolve":
      if (alert.status === "RESOLVED") return { error: "Already resolved." };
      await db.alert.update({
        where: { id },
        data: { status: "RESOLVED", resolvedAt: new Date(), notes: note ? appendNote(`Resolved — ${g.user.name}: ${note}`) : alert.notes },
      });
      break;
    case "reopen":
      if (alert.status !== "RESOLVED") return { error: "Only resolved alerts can be reopened." };
      await db.alert.update({ where: { id }, data: { status: "OPEN", resolvedAt: null, notes: note ? appendNote(`Reopened — ${g.user.name}: ${note}`) : alert.notes } });
      break;
    default:
      return { error: "Unknown action." };
  }

  await logAudit(g.user, {
    action: `alert.${kind}`,
    resourceType: "Alert",
    resourceId: id,
    resourceLabel: alert.title,
    branchId: alert.branchId,
    reason: note ?? undefined,
    riskLevel: "LOW",
  });

  revalidatePath("/alerts");
  revalidatePath("/dashboard");
  return { success: true };
}
