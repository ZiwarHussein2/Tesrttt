"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull } from "@/lib/form";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_TYPES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

export async function createIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("incidents");
  if (g.error) return g.error;

  const title = str(fd, "title");
  const description = str(fd, "description");
  if (title.length < 5) return { error: "Incident title is required." };
  if (description.length < 10) return { error: "Describe what happened." };
  const type = str(fd, "type");
  if (!INCIDENT_TYPES.includes(type as (typeof INCIDENT_TYPES)[number])) return { error: "Select a type." };
  const severity = str(fd, "severity");
  if (!INCIDENT_SEVERITIES.includes(severity as (typeof INCIDENT_SEVERITIES)[number])) return { error: "Select a severity." };

  const branchId = strOrNull(fd, "branchId");
  if (branchId && !branchAllowed(g.user, branchId)) return { error: "You cannot open incidents for another branch." };

  const incident = await db.incident.create({
    data: {
      title, description, type, severity, branchId,
      ownerName: g.user.name,
      impact: strOrNull(fd, "impact"),
      events: { create: { note: "Incident detected and recorded.", byName: g.user.name } },
    },
  });

  await logAudit(g.user, {
    action: "incident.create",
    resourceType: "Incident",
    resourceId: incident.id,
    resourceLabel: title,
    branchId,
    newValue: { type, severity },
    riskLevel: severity === "CRITICAL" || severity === "HIGH" ? "HIGH" : "MEDIUM",
  });

  revalidatePath("/incidents");
  return { success: true };
}

const FLOW: string[] = [...INCIDENT_STATUSES];

export async function advanceIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("incidents");
  if (g.error) return g.error;

  const id = str(fd, "incidentId");
  const target = str(fd, "status");
  if (!FLOW.includes(target)) return { error: "Invalid status." };

  const incident = await db.incident.findUnique({ where: { id } });
  if (!incident) return { error: "Incident not found." };
  if (incident.branchId && !branchAllowed(g.user, incident.branchId)) return { error: "You cannot manage another branch's incidents." };

  const currentIdx = FLOW.indexOf(incident.status);
  const targetIdx = FLOW.indexOf(target);
  if (targetIdx <= currentIdx) return { error: "Incidents move forward through the workflow; add a timeline note instead." };

  const note = str(fd, "reason");
  if (!note) return { error: "A note describing this step is required." };
  if (target === "CLOSED" && !str(fd, "rootCause") && !incident.rootCause) {
    return { error: "Provide the root cause before closing." };
  }

  await db.incident.update({
    where: { id },
    data: {
      status: target,
      ownerName: strOrNull(fd, "owner") ?? incident.ownerName,
      rootCause: strOrNull(fd, "rootCause") ?? incident.rootCause,
      correctiveAction: strOrNull(fd, "correctiveAction") ?? incident.correctiveAction,
      closedAt: target === "CLOSED" ? new Date() : incident.closedAt,
      events: { create: { note: `→ ${target.toLowerCase()}: ${note}`, byName: g.user.name } },
    },
  });

  await logAudit(g.user, {
    action: "incident.advance",
    resourceType: "Incident",
    resourceId: id,
    resourceLabel: incident.title,
    branchId: incident.branchId,
    oldValue: { status: incident.status },
    newValue: { status: target },
    reason: note,
    riskLevel: "MEDIUM",
  });

  revalidatePath("/incidents");
  revalidatePath(`/incidents/${id}`);
  return { success: true };
}

export async function addIncidentNote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("incidents");
  if (g.error) return g.error;

  const id = str(fd, "incidentId");
  const note = str(fd, "reason");
  if (!note) return { error: "Enter a note." };

  const incident = await db.incident.findUnique({ where: { id } });
  if (!incident) return { error: "Incident not found." };
  if (incident.branchId && !branchAllowed(g.user, incident.branchId)) return { error: "You cannot manage another branch's incidents." };

  await db.incidentEvent.create({ data: { incidentId: id, note, byName: g.user.name } });

  await logAudit(g.user, {
    action: "incident.note",
    resourceType: "Incident",
    resourceId: id,
    resourceLabel: incident.title,
    branchId: incident.branchId,
    reason: note,
    riskLevel: "LOW",
  });

  revalidatePath(`/incidents/${id}`);
  return { success: true };
}
