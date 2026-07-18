"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, bool } from "@/lib/form";
import type { ActionState } from "@/lib/action-state";

function agreementHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export async function issueAgreement(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("agreements");
  if (g.error) return g.error;

  const employeeId = str(fd, "employeeId");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { error: "Employee not found." };
  if (!branchAllowed(g.user, employee.branchId)) return { error: "You cannot modify another branch." };

  const title = str(fd, "title");
  const body = str(fd, "body");
  if (title.length < 3) return { error: "Agreement title is required." };
  if (body.length < 20) return { error: "Agreement terms are required (at least a few sentences)." };

  const latest = await db.agreement.findFirst({
    where: { employeeId, title },
    orderBy: { version: "desc" },
  });
  const version = (latest?.version ?? 0) + 1;

  const agreement = await db.agreement.create({
    data: {
      employeeId,
      branchId: employee.branchId,
      title,
      version,
      body,
      compensationSummary: strOrNull(fd, "compensationSummary"),
      status: "ISSUED",
      issuedAt: new Date(),
    },
  });

  await logAudit(g.user, {
    action: "agreement.issue",
    resourceType: "Agreement",
    resourceId: agreement.id,
    resourceLabel: `${title} v${version} — ${employee.firstName} ${employee.lastName}`,
    branchId: employee.branchId,
    newValue: { title, version, employee: `${employee.firstName} ${employee.lastName}` },
    riskLevel: "HIGH",
  });

  revalidatePath("/agreements");
  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

export async function recordAcceptance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("agreements");
  if (g.error) return g.error;

  const id = str(fd, "agreementId");
  const agreement = await db.agreement.findUnique({ where: { id }, include: { employee: true } });
  if (!agreement) return { error: "Agreement not found." };
  if (!branchAllowed(g.user, agreement.branchId)) return { error: "You cannot modify another branch." };
  if (agreement.status !== "ISSUED") return { error: "Only issued agreements can be accepted." };

  const statement = str(fd, "acceptanceStatement");
  if (statement.length < 10) return { error: "The acceptance statement is required as evidence." };

  const acceptedAt = new Date();
  const pdfHash = agreementHash([
    agreement.id, agreement.title, String(agreement.version),
    agreement.body, agreement.employeeId, acceptedAt.toISOString(),
  ]);

  await db.$transaction([
    // Supersede any previously accepted version of the same agreement title.
    db.agreement.updateMany({
      where: { employeeId: agreement.employeeId, title: agreement.title, status: "ACCEPTED", id: { not: id } },
      data: { status: "SUPERSEDED", supersededById: id },
    }),
    db.agreement.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        acceptedAt,
        acceptanceStatement: statement,
        otpVerified: bool(fd, "otpVerified"),
        deviceRecorded: bool(fd, "deviceRecorded"),
        networkRecorded: bool(fd, "networkRecorded"),
        locationRecorded: bool(fd, "locationRecorded"),
        pdfHash,
      },
    }),
  ]);

  await logAudit(g.user, {
    action: "agreement.accept",
    resourceType: "Agreement",
    resourceId: id,
    resourceLabel: `${agreement.title} v${agreement.version} — ${agreement.employee.firstName} ${agreement.employee.lastName}`,
    branchId: agreement.branchId,
    newValue: {
      acceptedAt: acceptedAt.toISOString(),
      otpVerified: bool(fd, "otpVerified"),
      deviceRecorded: bool(fd, "deviceRecorded"),
      networkRecorded: bool(fd, "networkRecorded"),
      locationRecorded: bool(fd, "locationRecorded"),
      pdfHash,
    },
    riskLevel: "HIGH",
  });

  revalidatePath("/agreements");
  revalidatePath(`/employees/${agreement.employeeId}`);
  return { success: true };
}

export async function terminateAgreement(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("agreements");
  if (g.error) return g.error;

  const id = str(fd, "agreementId");
  const agreement = await db.agreement.findUnique({ where: { id }, include: { employee: true } });
  if (!agreement) return { error: "Agreement not found." };
  if (!branchAllowed(g.user, agreement.branchId)) return { error: "You cannot modify another branch." };

  const reason = str(fd, "reason");
  if (!reason) return { error: "A termination reason is required." };

  await db.agreement.update({ where: { id }, data: { status: "TERMINATED" } });

  await logAudit(g.user, {
    action: "agreement.terminate",
    resourceType: "Agreement",
    resourceId: id,
    resourceLabel: `${agreement.title} v${agreement.version} — ${agreement.employee.firstName} ${agreement.employee.lastName}`,
    branchId: agreement.branchId,
    oldValue: { status: agreement.status },
    newValue: { status: "TERMINATED" },
    reason,
    riskLevel: "HIGH",
  });

  revalidatePath("/agreements");
  revalidatePath(`/employees/${agreement.employeeId}`);
  return { success: true };
}
