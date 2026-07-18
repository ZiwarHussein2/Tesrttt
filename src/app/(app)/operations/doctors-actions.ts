"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num, numOrNull } from "@/lib/form";
import type { ActionState } from "@/lib/action-state";

function revalidateDoctors() {
  revalidatePath("/operations/reports");
  revalidatePath("/operations/referrals");
  revalidatePath("/finance");
}

// ── Report doctors (remote reading doctors) ──

export async function createReportDoctor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("report-workflow");
  if (g.error) return g.error;

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Doctor name is required." };
  const agreedRate = num(fd, "agreedRate", -1);
  if (agreedRate < 0) return { error: "Agreed rate per report is required." };

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  const doctor = await db.reportDoctor.create({
    data: {
      companyId: company.id,
      name,
      specialty: strOrNull(fd, "specialty"),
      agreedRate,
      approvedDevice: false,
    },
  });

  await logAudit(g.user, {
    action: "report-doctor.create",
    resourceType: "ReportDoctor",
    resourceId: doctor.id,
    resourceLabel: doctor.name,
    newValue: { name, agreedRate },
    riskLevel: "MEDIUM",
  });

  revalidateDoctors();
  return { success: true };
}

export async function updateReportDoctor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("report-workflow");
  if (g.error) return g.error;

  const id = str(fd, "doctorId");
  const doctor = await db.reportDoctor.findUnique({ where: { id } });
  if (!doctor) return { error: "Doctor not found." };

  const agreedRate = num(fd, "agreedRate", doctor.agreedRate);
  const contractStatus = str(fd, "contractStatus") || doctor.contractStatus;
  if (!["ACTIVE", "SUSPENDED", "ENDED"].includes(contractStatus)) return { error: "Invalid contract status." };
  const rateChanged = agreedRate !== doctor.agreedRate;
  const reason = str(fd, "reason");
  if (rateChanged && !reason) return { error: "A reason is required for rate changes." };

  await db.reportDoctor.update({
    where: { id },
    data: {
      agreedRate,
      contractStatus,
      approvedDevice: str(fd, "approvedDevice") === "on" || (!fd.has("approvedDevice") && doctor.approvedDevice),
      suspiciousFlag: str(fd, "suspiciousFlag") === "on",
      lastAccessRegion: strOrNull(fd, "lastAccessRegion") ?? doctor.lastAccessRegion,
    },
  });

  await logAudit(g.user, {
    action: rateChanged ? "report-doctor.rate-change" : "report-doctor.update",
    resourceType: "ReportDoctor",
    resourceId: id,
    resourceLabel: doctor.name,
    oldValue: { agreedRate: doctor.agreedRate, contractStatus: doctor.contractStatus, suspiciousFlag: doctor.suspiciousFlag },
    newValue: { agreedRate, contractStatus },
    reason: reason || undefined,
    riskLevel: rateChanged ? "HIGH" : "MEDIUM",
  });

  revalidateDoctors();
  return { success: true };
}

// ── Referral doctors ──

export async function createReferralDoctor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("referrals");
  if (g.error) return g.error;

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Doctor name is required." };
  const dealType = str(fd, "dealType");
  if (!["FIXED", "PERCENT", "NONE", "DISCOUNT_CONVERSION"].includes(dealType)) return { error: "Select a deal type." };

  const fixedAmount = numOrNull(fd, "fixedAmount");
  const percent = numOrNull(fd, "percent");
  if ((dealType === "FIXED" || dealType === "DISCOUNT_CONVERSION") && (!fixedAmount || fixedAmount <= 0)) {
    return { error: "Enter the fixed amount for this deal type." };
  }
  if (dealType === "PERCENT" && (!percent || percent <= 0 || percent > 100)) {
    return { error: "Enter a percentage between 1 and 100." };
  }

  const company = await db.company.findFirst();
  if (!company) return { error: "Company record not found." };

  const doctor = await db.referralDoctor.create({
    data: {
      companyId: company.id,
      name,
      specialty: strOrNull(fd, "specialty"),
      phone: strOrNull(fd, "phone"),
      dealType,
      fixedAmount: dealType === "PERCENT" || dealType === "NONE" ? null : fixedAmount,
      percent: dealType === "PERCENT" ? percent : null,
      notes: strOrNull(fd, "notes"),
    },
  });

  await logAudit(g.user, {
    action: "referral-doctor.create",
    resourceType: "ReferralDoctor",
    resourceId: doctor.id,
    resourceLabel: doctor.name,
    newValue: { name, dealType, fixedAmount: doctor.fixedAmount, percent: doctor.percent },
    riskLevel: "MEDIUM",
  });

  revalidateDoctors();
  return { success: true };
}

export async function updateReferralDeal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("referrals");
  if (g.error) return g.error;

  const id = str(fd, "doctorId");
  const doctor = await db.referralDoctor.findUnique({ where: { id } });
  if (!doctor) return { error: "Doctor not found." };

  const dealType = str(fd, "dealType") || doctor.dealType;
  const fixedAmount = numOrNull(fd, "fixedAmount") ?? doctor.fixedAmount;
  const percent = numOrNull(fd, "percent") ?? doctor.percent;
  const contractStatus = str(fd, "contractStatus") || doctor.contractStatus;
  const reason = str(fd, "reason");
  if (!reason) return { error: "A reason is required for deal changes — recorded in the audit log." };

  await db.referralDoctor.update({
    where: { id },
    data: { dealType, fixedAmount, percent, contractStatus },
  });

  await logAudit(g.user, {
    action: "referral-doctor.deal-change",
    resourceType: "ReferralDoctor",
    resourceId: id,
    resourceLabel: doctor.name,
    oldValue: { dealType: doctor.dealType, fixedAmount: doctor.fixedAmount, percent: doctor.percent, contractStatus: doctor.contractStatus },
    newValue: { dealType, fixedAmount, percent, contractStatus },
    reason,
    riskLevel: "HIGH",
  });

  revalidateDoctors();
  return { success: true };
}

// ── Doctor payments (settling liabilities) ──

export async function recordDoctorPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("referrals");
  if (g.error) return g.error;

  const referralDoctorId = strOrNull(fd, "referralDoctorId");
  const reportDoctorId = strOrNull(fd, "reportDoctorId");
  if (!referralDoctorId && !reportDoctorId) return { error: "Doctor is required." };

  const amount = num(fd, "amount", -1);
  if (amount <= 0) return { error: "Amount must be greater than zero." };

  let label = "";
  if (referralDoctorId) {
    const d = await db.referralDoctor.findUnique({ where: { id: referralDoctorId } });
    if (!d) return { error: "Referral doctor not found." };
    label = `Dr. ${d.name} (referral)`;
  } else if (reportDoctorId) {
    const d = await db.reportDoctor.findUnique({ where: { id: reportDoctorId } });
    if (!d) return { error: "Report doctor not found." };
    label = `Dr. ${d.name} (reports)`;
  }

  const payment = await db.doctorPayment.create({
    data: {
      referralDoctorId,
      reportDoctorId,
      amount,
      method: str(fd, "method") || "CASH",
      recordedByName: g.user.name,
      notes: strOrNull(fd, "notes"),
    },
  });

  // Doctor payments are real money out — post as approved professional fees.
  const anyBranch = await db.branch.findFirst({ orderBy: { createdAt: "asc" } });
  if (anyBranch) {
    await db.expense.create({
      data: {
        branchId: g.user.branchId ?? anyBranch.id,
        category: "PROFESSIONAL_FEES",
        description: `Doctor payment — ${label}`,
        amount,
        expenseDate: new Date(),
        paymentMethod: str(fd, "method") || "CASH",
        submittedById: g.user.id,
        submittedByName: g.user.name,
        reviewedById: g.user.id,
        reviewedByName: g.user.name,
        status: "APPROVED",
      },
    });
  }

  await logAudit(g.user, {
    action: "doctor-payment.record",
    resourceType: "DoctorPayment",
    resourceId: payment.id,
    resourceLabel: label,
    newValue: { amount, method: payment.method },
    riskLevel: "HIGH",
  });

  revalidateDoctors();
  return { success: true };
}
