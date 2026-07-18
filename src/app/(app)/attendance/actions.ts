"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, dateOrNull, dayKey, isValidTime } from "@/lib/form";
import type { ActionState } from "@/lib/action-state";

const GRACE_MINUTES = 5;

function combine(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

interface Computed {
  status: string;
  lateMinutes: number;
  overtimeMinutes: number;
  exception: boolean;
  exceptionType: string | null;
}

function compute(
  day: Date,
  scheduledStart: string,
  scheduledEnd: string,
  checkIn: Date | null,
  checkOut: Date | null,
  manualStatus: string | null,
): Computed {
  if (manualStatus && ["ABSENT", "LEAVE", "HOLIDAY"].includes(manualStatus)) {
    return { status: manualStatus, lateMinutes: 0, overtimeMinutes: 0, exception: manualStatus === "ABSENT", exceptionType: manualStatus === "ABSENT" ? "ABSENCE" : null };
  }
  if (!checkIn) {
    return { status: "ABSENT", lateMinutes: 0, overtimeMinutes: 0, exception: true, exceptionType: "NO_CHECK_IN" };
  }
  const start = combine(day, scheduledStart);
  const end = combine(day, scheduledEnd);
  const late = Math.max(0, minutesBetween(start, checkIn) - GRACE_MINUTES);
  const overtime = checkOut ? Math.max(0, minutesBetween(end, checkOut)) : 0;
  const missingCheckout = !checkOut;
  return {
    status: late > 0 ? "LATE" : "PRESENT",
    lateMinutes: late,
    overtimeMinutes: overtime,
    exception: missingCheckout || late > 60,
    exceptionType: missingCheckout ? "MISSING_CHECKOUT" : late > 60 ? "SEVERE_LATENESS" : null,
  };
}

export async function recordAttendance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("attendance");
  if (g.error) return g.error;

  const employeeId = str(fd, "employeeId");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { error: "Employee not found." };
  if (!branchAllowed(g.user, employee.branchId)) return { error: "You cannot modify another branch." };

  const day = dateOrNull(fd, "date") ?? new Date();
  const key = dayKey(day);
  const checkInTime = str(fd, "checkIn");
  const checkOutTime = str(fd, "checkOut");
  const manualStatus = strOrNull(fd, "status");

  if (checkInTime && !isValidTime(checkInTime)) return { error: "Check-in must be HH:MM (24h)." };
  if (checkOutTime && !isValidTime(checkOutTime)) return { error: "Check-out must be HH:MM (24h)." };
  if (!checkInTime && !manualStatus) return { error: "Enter a check-in time or select a status (absent / leave / holiday)." };

  const existing = await db.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date: key } },
  });
  if (existing) return { error: "A record for this employee and day already exists — use Correct instead." };

  const checkIn = checkInTime ? combine(day, checkInTime) : null;
  const checkOut = checkOutTime ? combine(day, checkOutTime) : null;
  if (checkIn && checkOut && checkOut <= checkIn) return { error: "Check-out must be after check-in." };

  const c = compute(day, employee.workScheduleStart, employee.workScheduleEnd, checkIn, checkOut, manualStatus);

  const record = await db.attendanceRecord.create({
    data: {
      employeeId,
      branchId: employee.branchId,
      date: key,
      scheduledStart: employee.workScheduleStart,
      scheduledEnd: employee.workScheduleEnd,
      checkIn,
      checkOut,
      status: c.status,
      lateMinutes: c.lateMinutes,
      overtimeMinutes: c.overtimeMinutes,
      exception: c.exception,
      exceptionType: c.exceptionType,
      reviewStatus: c.exception ? "PENDING" : "NONE",
      deviceMatch: "UNKNOWN",
      networkMatch: "UNKNOWN",
      locationStatus: "UNAVAILABLE",
      notes: strOrNull(fd, "notes"),
    },
  });

  await logAudit(g.user, {
    action: "attendance.record",
    resourceType: "AttendanceRecord",
    resourceId: record.id,
    resourceLabel: `${employee.firstName} ${employee.lastName} · ${key.toISOString().slice(0, 10)}`,
    branchId: employee.branchId,
    departmentId: employee.departmentId,
    newValue: { status: c.status, checkIn: checkInTime || null, checkOut: checkOutTime || null },
    riskLevel: "LOW",
  });

  revalidatePath("/attendance");
  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

export async function correctAttendance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("attendance");
  if (g.error) return g.error;

  const id = str(fd, "recordId");
  const record = await db.attendanceRecord.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!record) return { error: "Attendance record not found." };
  if (!branchAllowed(g.user, record.branchId)) return { error: "You cannot modify another branch." };

  const reason = str(fd, "reason");
  if (!reason) return { error: "A correction reason is required — it becomes legal evidence." };

  const checkInTime = str(fd, "checkIn");
  const checkOutTime = str(fd, "checkOut");
  const manualStatus = strOrNull(fd, "status");
  if (checkInTime && !isValidTime(checkInTime)) return { error: "Check-in must be HH:MM (24h)." };
  if (checkOutTime && !isValidTime(checkOutTime)) return { error: "Check-out must be HH:MM (24h)." };

  const day = record.date;
  const checkIn = checkInTime ? combine(day, checkInTime) : null;
  const checkOut = checkOutTime ? combine(day, checkOutTime) : null;
  if (checkIn && checkOut && checkOut <= checkIn) return { error: "Check-out must be after check-in." };

  const c = compute(day, record.scheduledStart, record.scheduledEnd, checkIn, checkOut, manualStatus);

  const updated = await db.attendanceRecord.update({
    where: { id },
    data: {
      checkIn,
      checkOut,
      status: c.status,
      lateMinutes: c.lateMinutes,
      overtimeMinutes: c.overtimeMinutes,
      exception: c.exception,
      exceptionType: c.exceptionType,
      reviewStatus: "REVIEWED",
      correctionReason: reason,
      correctedById: g.user.id,
    },
  });

  await logAudit(g.user, {
    action: "attendance.correct",
    resourceType: "AttendanceRecord",
    resourceId: id,
    resourceLabel: `${record.employee.firstName} ${record.employee.lastName} · ${day.toISOString().slice(0, 10)}`,
    branchId: record.branchId,
    departmentId: record.employee.departmentId,
    oldValue: {
      status: record.status,
      checkIn: record.checkIn?.toISOString() ?? null,
      checkOut: record.checkOut?.toISOString() ?? null,
      lateMinutes: record.lateMinutes,
      overtimeMinutes: record.overtimeMinutes,
    },
    newValue: {
      status: updated.status,
      checkIn: updated.checkIn?.toISOString() ?? null,
      checkOut: updated.checkOut?.toISOString() ?? null,
      lateMinutes: updated.lateMinutes,
      overtimeMinutes: updated.overtimeMinutes,
    },
    reason,
    riskLevel: "HIGH",
  });

  revalidatePath("/attendance");
  revalidatePath(`/employees/${record.employeeId}`);
  return { success: true };
}

export async function reviewAttendanceException(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("attendance");
  if (g.error) return g.error;

  const id = str(fd, "recordId");
  const record = await db.attendanceRecord.findUnique({ where: { id }, include: { employee: true } });
  if (!record) return { error: "Record not found." };
  if (!branchAllowed(g.user, record.branchId)) return { error: "You cannot modify another branch." };

  const reason = str(fd, "reason");
  if (!reason) return { error: "A review note is required." };

  await db.attendanceRecord.update({
    where: { id },
    data: { reviewStatus: "REVIEWED", notes: reason },
  });

  await logAudit(g.user, {
    action: "attendance.review-exception",
    resourceType: "AttendanceRecord",
    resourceId: id,
    resourceLabel: `${record.employee.firstName} ${record.employee.lastName} · ${record.date.toISOString().slice(0, 10)}`,
    branchId: record.branchId,
    reason,
    riskLevel: "MEDIUM",
  });

  revalidatePath("/attendance");
  return { success: true };
}
