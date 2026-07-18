"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num, numOrNull, dateOrNull } from "@/lib/form";
import { PAYMENT_METHODS } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

function revalidateOps() {
  revalidatePath("/queues");
  revalidatePath("/live");
  revalidatePath("/patients");
  revalidatePath("/operations/radiology");
  revalidatePath("/operations/reports");
  revalidatePath("/dashboard");
}

function publicRef(): string {
  // Non-guessable public patient reference.
  return `MRN-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function visitNumber(): Promise<string> {
  const today = new Date();
  const prefix = `V-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const count = await db.visit.count({ where: { createdAt: { gte: startOfDay } } });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function activeMultiplier(windows: { startTime: string; endTime: string; priceMultiplier: number }[]): number {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const w of windows) {
    const [sh, sm] = w.startTime.split(":").map(Number);
    const [eh, em] = w.endTime.split(":").map(Number);
    if (cur >= sh * 60 + sm && cur < eh * 60 + em) return w.priceMultiplier;
  }
  return 1;
}

// ── Register a visit (with existing or new patient) ──

export async function registerVisit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const departmentId = str(fd, "departmentId");
  const department = await db.department.findUnique({
    where: { id: departmentId },
    include: { pricingWindows: true, branch: true },
  });
  if (!department) return { error: "Department not found." };
  if (!branchAllowed(g.user, department.branchId)) return { error: "You cannot operate another branch's queue." };
  if (department.status !== "ACTIVE") return { error: "This department is not active." };

  const serviceId = str(fd, "serviceId");
  const service = await db.service.findUnique({ where: { id: serviceId } });
  if (!service || service.departmentId !== departmentId || !service.active) {
    return { error: "Select a valid service for this department." };
  }

  // Existing patient by reference, or create a new one.
  let patientId: string;
  const existingRef = str(fd, "patientRef");
  if (existingRef) {
    const patient = await db.patient.findUnique({ where: { publicRef: existingRef.toUpperCase() } });
    if (!patient) return { error: `No patient found with reference ${existingRef}.` };
    patientId = patient.id;
  } else {
    const firstName = str(fd, "firstName");
    const lastName = str(fd, "lastName");
    if (!firstName || !lastName) return { error: "Enter the patient's name (or an existing patient reference)." };
    const birthYear = numOrNull(fd, "birthYear");
    if (birthYear !== null && (birthYear < 1900 || birthYear > new Date().getFullYear())) {
      return { error: "Enter a valid birth year." };
    }
    const patient = await db.patient.create({
      data: {
        companyId: department.branch.companyId,
        publicRef: publicRef(),
        firstName,
        lastName,
        gender: strOrNull(fd, "gender"),
        birthYear,
        phone: strOrNull(fd, "phone"),
        privacyNoticeVersion: "1.0",
      },
    });
    patientId = patient.id;
  }

  const multiplier = activeMultiplier(department.pricingWindows);
  const price = Math.round(service.basePrice * multiplier);

  // Optional referral doctor attribution.
  const referralDoctorId = strOrNull(fd, "referralDoctorId");

  const visit = await db.visit.create({
    data: {
      patientId,
      branchId: department.branchId,
      departmentId,
      serviceId,
      visitNumber: await visitNumber(),
      qrToken: randomBytes(16).toString("hex"),
      price,
      reportRequired: service.reportRequired,
      priority: str(fd, "priority") === "URGENT" ? "URGENT" : "NORMAL",
    },
    include: { patient: { select: { publicRef: true } } },
  });

  if (referralDoctorId) {
    const doctor = await db.referralDoctor.findUnique({ where: { id: referralDoctorId } });
    if (doctor && doctor.contractStatus === "ACTIVE") {
      const commission =
        doctor.dealType === "FIXED" ? (doctor.fixedAmount ?? 0)
        : doctor.dealType === "PERCENT" ? Math.round((price * (doctor.percent ?? 0)) / 100)
        : doctor.dealType === "DISCOUNT_CONVERSION" ? (doctor.fixedAmount ?? 0)
        : 0;
      await db.referral.create({
        data: {
          referralDoctorId,
          visitId: visit.id,
          branchId: department.branchId,
          commissionAmount: doctor.dealType === "DISCOUNT_CONVERSION" ? 0 : commission,
          convertedToDiscount: doctor.dealType === "DISCOUNT_CONVERSION",
        },
      });
      // Commission-to-discount deals reduce the patient price instead.
      if (doctor.dealType === "DISCOUNT_CONVERSION" && commission > 0) {
        await db.visit.update({
          where: { id: visit.id },
          data: { discountAmount: Math.min(commission, price) },
        });
        await db.discountRequest.create({
          data: {
            branchId: department.branchId,
            departmentId,
            visitId: visit.id,
            type: "REFERRAL_CONVERSION",
            oldPrice: price,
            newPrice: Math.max(0, price - commission),
            reason: `Referral commission of Dr. ${doctor.name} converted to patient discount`,
            requestedByName: g.user.name,
            reviewedByName: "Automatic (referral deal)",
            status: "APPROVED",
            decidedAt: new Date(),
          },
        });
      }
    }
  }

  await logAudit(g.user, {
    action: "visit.register",
    resourceType: "Visit",
    resourceId: visit.id,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: department.branchId,
    departmentId,
    newValue: { service: service.name, price, priority: visit.priority },
    riskLevel: "LOW",
  });

  revalidateOps();
  return { success: true };
}

// ── Payment ──

export async function recordPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const visit = await db.visit.findUnique({
    where: { id: visitId },
    include: { patient: { select: { publicRef: true } }, department: { select: { id: true, name: true } } },
  });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's queue." };
  if (["CANCELLED", "COMPLETED"].includes(visit.status)) return { error: "This visit is closed." };
  if (visit.paymentStatus === "PAID") return { error: "This visit is already fully paid." };

  const method = str(fd, "method") || "CASH";
  if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) return { error: "Invalid payment method." };

  // Optional discount code.
  let discountAmount = visit.discountAmount;
  const codeStr = str(fd, "discountCode").toUpperCase();
  if (codeStr) {
    const code = await db.discountCode.findUnique({ where: { code: codeStr } });
    const now = new Date();
    if (!code || !code.active) return { error: "Discount code not found or inactive." };
    if (code.validFrom && code.validFrom > now) return { error: "Discount code is not valid yet." };
    if (code.validTo && code.validTo < now) return { error: "Discount code has expired." };
    if (code.maxUses && code.usedCount >= code.maxUses) return { error: "Discount code usage limit reached." };
    const codeValue = code.percent ? Math.round((visit.price * code.percent) / 100) : (code.amount ?? 0);
    discountAmount = Math.min(visit.price, discountAmount + codeValue);
    await db.discountCode.update({ where: { id: code.id }, data: { usedCount: { increment: 1 } } });
    await db.discountRequest.create({
      data: {
        branchId: visit.branchId,
        departmentId: visit.departmentId,
        visitId: visit.id,
        type: "CODE",
        code: code.code,
        oldPrice: visit.price,
        newPrice: visit.price - discountAmount,
        reason: `Discount code ${code.code} applied at payment`,
        requestedByName: g.user.name,
        reviewedByName: "Automatic (code)",
        status: "APPROVED",
        decidedAt: new Date(),
      },
    });
  }

  const due = visit.price - discountAmount - visit.paidAmount;
  if (due <= 0) return { error: "Nothing left to pay on this visit." };
  const amount = num(fd, "amount", due);
  if (amount <= 0) return { error: "Amount must be greater than zero." };
  if (amount > due) return { error: `Amount exceeds the outstanding balance (${due.toLocaleString()} IQD).` };

  const newPaid = visit.paidAmount + amount;
  const fullyPaid = newPaid >= visit.price - discountAmount;

  await db.$transaction([
    db.visit.update({
      where: { id: visitId },
      data: {
        paidAmount: newPaid,
        discountAmount,
        paymentMethod: method,
        paymentStatus: fullyPaid ? "PAID" : "PARTIAL",
        status: visit.status === "REGISTERED" && fullyPaid ? "WAITING" : visit.status === "REGISTERED" ? "PAID" : visit.status,
      },
    }),
    db.incomeEntry.create({
      data: {
        branchId: visit.branchId,
        departmentId: visit.departmentId,
        visitId: visit.id,
        category: "PATIENT_SERVICE",
        description: `Payment — ${visit.visitNumber}`,
        amount,
        method,
        recordedByName: g.user.name,
      },
    }),
  ]);

  await logAudit(g.user, {
    action: "visit.payment",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    newValue: { amount, method, totalPaid: newPaid, discountAmount, fullyPaid },
    riskLevel: "LOW",
  });

  revalidateOps();
  revalidatePath("/finance/income");
  return { success: true };
}

// ── Queue lifecycle transitions ──

interface TransitionSpec {
  from: string[];
  to: string;
  action: string;
  risk?: "LOW" | "MEDIUM" | "HIGH";
  stamp?: (now: Date) => Record<string, Date>;
}

const TRANSITIONS: Record<string, TransitionSpec> = {
  call: { from: ["PAID", "WAITING"], to: "CALLED", action: "visit.call", stamp: (n) => ({ calledAt: n }) },
  start: { from: ["CALLED", "WAITING", "PAID"], to: "IN_PROGRESS", action: "visit.start", stamp: (n) => ({ scanStartedAt: n }) },
  "complete-scan": { from: ["IN_PROGRESS"], to: "SCAN_COMPLETED", action: "visit.complete-scan", stamp: (n) => ({ scanCompletedAt: n }) },
  "complete-printing": { from: ["SCAN_COMPLETED"], to: "PRINTING_COMPLETED", action: "visit.complete-printing", stamp: (n) => ({ printedAt: n }) },
  "complete-visit": { from: ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_COMPLETED"], to: "COMPLETED", action: "visit.complete", stamp: (n) => ({ completedAt: n }) },
};

export async function transitionVisit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const kind = str(fd, "transition");
  const spec = TRANSITIONS[kind];
  if (!spec) return { error: "Unknown transition." };

  const visit = await db.visit.findUnique({
    where: { id: visitId },
    include: { patient: { select: { publicRef: true } }, service: true, department: true },
  });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's queue." };
  if (!spec.from.includes(visit.status)) {
    return { error: `Cannot ${kind.replace(/-/g, " ")} a visit in status ${visit.status.replace(/_/g, " ").toLowerCase()}.` };
  }
  if (kind === "start" && visit.paymentStatus === "UNPAID") {
    return { error: "Payment must be recorded before the examination starts." };
  }
  // Completing a scan that requires a report must go through the report flow.
  if (kind === "complete-visit" && visit.reportRequired && visit.status !== "REPORT_COMPLETED") {
    return { error: "This test requires a doctor report before completion." };
  }

  const now = new Date();
  await db.visit.update({
    where: { id: visitId },
    data: { status: spec.to, ...(spec.stamp ? spec.stamp(now) : {}) },
  });

  // Consuming the service recipe when the scan completes keeps inventory true.
  if (kind === "complete-scan" && visit.service) {
    const recipe = await db.serviceRecipeItem.findMany({
      where: { serviceId: visit.service.id, optional: false },
      include: { inventoryItem: true },
    });
    for (const r of recipe) {
      await db.$transaction([
        db.inventoryMovement.create({
          data: {
            itemId: r.inventoryItemId,
            branchId: visit.branchId,
            type: "CONSUMED",
            quantity: -r.quantity,
            reason: `Consumed by ${visit.visitNumber} (${visit.service.name})`,
            visitId: visit.id,
            recordedByName: g.user.name,
          },
        }),
        db.inventoryItem.update({
          where: { id: r.inventoryItemId },
          data: { quantity: { decrement: r.quantity } },
        }),
      ]);
    }
  }

  await logAudit(g.user, {
    action: spec.action,
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    oldValue: { status: visit.status },
    newValue: { status: spec.to },
    riskLevel: spec.risk ?? "LOW",
  });

  revalidateOps();
  return { success: true };
}

export async function setVisitPriority(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: { select: { publicRef: true } } } });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's queue." };

  const priority = visit.priority === "URGENT" ? "NORMAL" : "URGENT";
  const reason = str(fd, "reason");
  if (priority === "URGENT" && !reason) return { error: "A reason is required to mark a visit urgent." };

  await db.visit.update({ where: { id: visitId }, data: { priority } });

  await logAudit(g.user, {
    action: "visit.priority",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    oldValue: { priority: visit.priority },
    newValue: { priority },
    reason: reason || undefined,
    riskLevel: "MEDIUM",
  });

  revalidateOps();
  return { success: true };
}

export async function cancelVisit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: { select: { publicRef: true } } } });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's queue." };
  if (["COMPLETED", "CANCELLED"].includes(visit.status)) return { error: "This visit is already closed." };

  const reason = str(fd, "reason");
  if (!reason) return { error: "A cancellation reason is required." };

  const refund = visit.paidAmount > 0;
  await db.$transaction([
    db.visit.update({
      where: { id: visitId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
        paymentStatus: refund ? "REFUNDED" : visit.paymentStatus,
      },
    }),
    ...(refund
      ? [
          db.incomeEntry.create({
            data: {
              branchId: visit.branchId,
              departmentId: visit.departmentId,
              visitId: visit.id,
              category: "PATIENT_SERVICE",
              description: `Refund — ${visit.visitNumber} (cancelled)`,
              amount: -visit.paidAmount,
              method: visit.paymentMethod ?? "CASH",
              recordedByName: g.user.name,
            },
          }),
        ]
      : []),
  ]);

  await logAudit(g.user, {
    action: "visit.cancel",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    oldValue: { status: visit.status, paidAmount: visit.paidAmount },
    newValue: { status: "CANCELLED", refunded: refund },
    reason,
    riskLevel: refund ? "HIGH" : "MEDIUM",
  });

  revalidateOps();
  revalidatePath("/finance/income");
  return { success: true };
}

export async function rescheduleVisit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: { select: { publicRef: true } } } });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's queue." };
  if (!["REGISTERED", "PAID", "WAITING", "CALLED"].includes(visit.status)) {
    return { error: "Only visits that have not started can be rescheduled." };
  }

  const to = dateOrNull(fd, "rescheduledTo");
  if (!to || to < new Date()) return { error: "Choose a future date and time." };
  const reason = str(fd, "reason");
  if (!reason) return { error: "A reason is required." };

  await db.visit.update({
    where: { id: visitId },
    data: { status: "RESCHEDULED", rescheduledTo: to },
  });

  await logAudit(g.user, {
    action: "visit.reschedule",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    oldValue: { status: visit.status },
    newValue: { status: "RESCHEDULED", rescheduledTo: to.toISOString() },
    reason,
    riskLevel: "LOW",
  });

  revalidateOps();
  return { success: true };
}

// Return a rescheduled visit to the queue.
export async function requeueVisit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("queues");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: { select: { publicRef: true } } } });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's queue." };
  if (visit.status !== "RESCHEDULED") return { error: "Only rescheduled visits can be re-queued." };

  await db.visit.update({
    where: { id: visitId },
    data: { status: visit.paymentStatus === "PAID" ? "WAITING" : "REGISTERED", registeredAt: new Date() },
  });

  await logAudit(g.user, {
    action: "visit.requeue",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    oldValue: { status: "RESCHEDULED" },
    newValue: { status: visit.paymentStatus === "PAID" ? "WAITING" : "REGISTERED" },
    riskLevel: "LOW",
  });

  revalidateOps();
  return { success: true };
}

// ── Report workflow ──

export async function assignReportDoctor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("report-workflow");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const doctorId = str(fd, "reportDoctorId");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: { select: { publicRef: true } } } });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's visits." };
  if (!visit.reportRequired) return { error: "This visit does not require a report." };
  if (!["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING"].includes(visit.status)) {
    return { error: "The scan must be completed before assigning a report doctor." };
  }

  const doctor = await db.reportDoctor.findUnique({ where: { id: doctorId } });
  if (!doctor || doctor.contractStatus !== "ACTIVE") return { error: "Select an active report doctor." };

  const enteredRate = numOrNull(fd, "rate");
  const rate = enteredRate ?? doctor.agreedRate;
  const rateException = enteredRate !== null && enteredRate !== doctor.agreedRate;
  if (rateException && !str(fd, "reason")) {
    return { error: `Entered rate differs from the agreed rate (${doctor.agreedRate.toLocaleString()} IQD) — a reason is required.` };
  }

  await db.visit.update({
    where: { id: visitId },
    data: { reportDoctorId: doctorId, reportRate: rate, reportAssignedAt: new Date(), status: "REPORT_PENDING" },
  });

  await logAudit(g.user, {
    action: rateException ? "report.assign-rate-exception" : "report.assign",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    newValue: { doctor: doctor.name, rate, agreedRate: doctor.agreedRate, rateException },
    reason: strOrNull(fd, "reason") ?? undefined,
    riskLevel: rateException ? "HIGH" : "LOW",
  });

  revalidateOps();
  return { success: true };
}

export async function completeReport(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("report-workflow");
  if (g.error) return g.error;

  const visitId = str(fd, "visitId");
  const visit = await db.visit.findUnique({
    where: { id: visitId },
    include: { patient: { select: { publicRef: true } }, department: true },
  });
  if (!visit) return { error: "Visit not found." };
  if (!branchAllowed(g.user, visit.branchId)) return { error: "You cannot operate another branch's visits." };

  const isSonar = visit.department.type === "SONAR";
  if (isSonar) {
    if (visit.status !== "IN_PROGRESS") return { error: "Sonar reports are written while the examination is open." };
  } else if (visit.status !== "REPORT_PENDING") {
    return { error: "Assign a report doctor first." };
  }

  const reportText = str(fd, "reportText");
  if (reportText.length < 5) return { error: "Enter the report text." };

  await db.visit.update({
    where: { id: visitId },
    data: {
      status: "REPORT_COMPLETED",
      reportText,
      reportCompletedAt: new Date(),
      scanCompletedAt: visit.scanCompletedAt ?? new Date(),
    },
  });

  await logAudit(g.user, {
    action: "report.complete",
    resourceType: "Visit",
    resourceId: visitId,
    resourceLabel: `${visit.visitNumber} · ${visit.patient.publicRef}`,
    branchId: visit.branchId,
    departmentId: visit.departmentId,
    oldValue: { status: visit.status },
    newValue: { status: "REPORT_COMPLETED" },
    riskLevel: "LOW",
  });

  revalidateOps();
  return { success: true };
}
