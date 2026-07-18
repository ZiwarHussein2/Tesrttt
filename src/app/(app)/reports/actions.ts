"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str } from "@/lib/form";
import { REPORT_TYPES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

export async function saveReportConfig(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("reports");
  if (g.error) return g.error;

  const type = str(fd, "type");
  if (!REPORT_TYPES.includes(type as (typeof REPORT_TYPES)[number])) return { error: "Invalid report type." };
  const title = str(fd, "title");
  if (title.length < 3) return { error: "Report title is required." };

  const params = {
    type,
    title,
    branch: str(fd, "branch") || "ALL",
    preparedFor: str(fd, "preparedFor"),
    confidentiality: str(fd, "confidentiality") || "Confidential",
  };

  const saved = await db.savedReport.create({
    data: { userId: g.user.id, type, title, params: JSON.stringify(params) },
  });

  await logAudit(g.user, {
    action: "report.save-config",
    resourceType: "SavedReport",
    resourceId: saved.id,
    resourceLabel: title,
    riskLevel: "LOW",
  });

  revalidatePath("/reports");
  revalidatePath("/governance/board");
  return { success: true };
}

export async function deleteSavedReport(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("reports");
  if (g.error) return g.error;
  const id = str(fd, "savedId");
  const saved = await db.savedReport.findFirst({ where: { id, userId: g.user.id } });
  if (!saved) return { error: "Saved report not found." };
  await db.savedReport.delete({ where: { id } });
  await logAudit(g.user, {
    action: "report.delete-config",
    resourceType: "SavedReport",
    resourceId: id,
    resourceLabel: saved.title,
    riskLevel: "LOW",
  });
  revalidatePath("/reports");
  return { success: true };
}
