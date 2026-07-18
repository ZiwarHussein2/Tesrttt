"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num, dateOrNull } from "@/lib/form";
import type { ActionState } from "@/lib/action-state";

export async function upsertShareholder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("shareholders");
  if (g.error) return g.error;

  const id = strOrNull(fd, "shareholderId");
  const name = str(fd, "name");
  if (name.length < 2) return { error: "Shareholder name is required." };
  const ownershipPercent = num(fd, "ownershipPercent", -1);
  if (ownershipPercent < 0 || ownershipPercent > 100) return { error: "Ownership must be between 0 and 100%." };

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  // Ownership total cannot exceed 100%.
  const others = await db.shareholder.aggregate({
    where: id ? { id: { not: id } } : {},
    _sum: { ownershipPercent: true },
  });
  if ((others._sum.ownershipPercent ?? 0) + ownershipPercent > 100.0001) {
    return { error: `Total ownership would exceed 100% (others hold ${(others._sum.ownershipPercent ?? 0).toFixed(1)}%).` };
  }

  const data = {
    name,
    ownershipPercent,
    votingPercent: num(fd, "votingPercent", ownershipPercent),
    email: strOrNull(fd, "email"),
    notes: strOrNull(fd, "notes"),
  };

  const existing = id ? await db.shareholder.findUnique({ where: { id } }) : null;
  const shareholder = existing
    ? await db.shareholder.update({ where: { id: existing.id }, data })
    : await db.shareholder.create({ data: { ...data, companyId: company.id } });

  await logAudit(g.user, {
    action: existing ? "shareholder.update" : "shareholder.create",
    resourceType: "Shareholder",
    resourceId: shareholder.id,
    resourceLabel: name,
    oldValue: existing ? { ownershipPercent: existing.ownershipPercent, votingPercent: existing.votingPercent } : undefined,
    newValue: { ownershipPercent, votingPercent: data.votingPercent },
    riskLevel: "HIGH",
  });

  revalidatePath("/governance/shareholders");
  return { success: true };
}

export async function createBoardMeeting(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("board-reports");
  if (g.error) return g.error;

  const title = str(fd, "title");
  if (title.length < 3) return { error: "Meeting title is required." };
  const scheduledAt = dateOrNull(fd, "scheduledAt");
  if (!scheduledAt) return { error: "Choose a meeting date." };

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  const meeting = await db.boardMeeting.create({
    data: {
      companyId: company.id,
      title,
      scheduledAt,
      agenda: strOrNull(fd, "agenda"),
    },
  });

  await logAudit(g.user, {
    action: "board-meeting.create",
    resourceType: "BoardMeeting",
    resourceId: meeting.id,
    resourceLabel: title,
    newValue: { scheduledAt: scheduledAt.toISOString() },
    riskLevel: "MEDIUM",
  });

  revalidatePath("/governance/board");
  return { success: true };
}

export async function updateBoardMeeting(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("board-reports");
  if (g.error) return g.error;

  const id = str(fd, "meetingId");
  const meeting = await db.boardMeeting.findUnique({ where: { id } });
  if (!meeting) return { error: "Meeting not found." };

  const status = str(fd, "status") || meeting.status;
  if (!["SCHEDULED", "HELD", "CANCELLED"].includes(status)) return { error: "Invalid status." };

  await db.boardMeeting.update({
    where: { id },
    data: {
      status,
      agenda: strOrNull(fd, "agenda") ?? meeting.agenda,
      minutes: strOrNull(fd, "minutes") ?? meeting.minutes,
      resolutions: strOrNull(fd, "resolutions") ?? meeting.resolutions,
    },
  });

  await logAudit(g.user, {
    action: "board-meeting.update",
    resourceType: "BoardMeeting",
    resourceId: id,
    resourceLabel: meeting.title,
    oldValue: { status: meeting.status },
    newValue: { status },
    riskLevel: "MEDIUM",
  });

  revalidatePath("/governance/board");
  return { success: true };
}
