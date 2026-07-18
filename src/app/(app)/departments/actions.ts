"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num, numOrNull, bool, isValidTime } from "@/lib/form";
import { DEPARTMENT_TYPES, MACHINE_STATUSES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

function revalidate(branchId: string, departmentId?: string) {
  revalidatePath("/departments");
  revalidatePath(`/branches/${branchId}`);
  if (departmentId) revalidatePath(`/departments/${departmentId}`);
}

export async function createDepartment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const branchId = str(fd, "branchId");
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };
  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) return { error: "Branch not found." };

  const schema = z.object({
    type: z.enum(DEPARTMENT_TYPES),
    name: z.string().min(2, "Department name is required."),
    targetWaitMinutes: z.number().int().min(1).max(600),
    dailyCapacity: z.number().int().min(1).max(2000),
  });
  const parsed = schema.safeParse({
    type: str(fd, "type"),
    name: str(fd, "name"),
    targetWaitMinutes: num(fd, "targetWaitMinutes", 30),
    dailyCapacity: num(fd, "dailyCapacity", 40),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const start = str(fd, "operatingHoursStart") || "08:00";
  const end = str(fd, "operatingHoursEnd") || "21:30";
  if (!isValidTime(start) || !isValidTime(end)) return { error: "Operating hours must be HH:MM (24h)." };

  const department = await db.department.create({
    data: {
      branchId,
      type: parsed.data.type,
      name: parsed.data.name,
      targetWaitMinutes: parsed.data.targetWaitMinutes,
      dailyCapacity: parsed.data.dailyCapacity,
      operatingHoursStart: start,
      operatingHoursEnd: end,
    },
  });

  await logAudit(g.user, {
    action: "department.create",
    resourceType: "Department",
    resourceId: department.id,
    resourceLabel: `${department.name} (${branch.name})`,
    branchId,
    departmentId: department.id,
    newValue: parsed.data,
    riskLevel: "MEDIUM",
  });

  revalidate(branchId, department.id);
  return { success: true };
}

export async function updateDepartment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const id = str(fd, "departmentId");
  const existing = await db.department.findUnique({ where: { id } });
  if (!existing) return { error: "Department not found." };
  if (!branchAllowed(g.user, existing.branchId)) return { error: "You cannot modify another branch." };

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Department name is required." };
  const status = str(fd, "status") || existing.status;
  if (!["ACTIVE", "PAUSED", "CLOSED"].includes(status)) return { error: "Invalid status." };
  const start = str(fd, "operatingHoursStart") || existing.operatingHoursStart;
  const end = str(fd, "operatingHoursEnd") || existing.operatingHoursEnd;
  if (!isValidTime(start) || !isValidTime(end)) return { error: "Operating hours must be HH:MM (24h)." };

  const updated = await db.department.update({
    where: { id },
    data: {
      name,
      status,
      targetWaitMinutes: num(fd, "targetWaitMinutes", existing.targetWaitMinutes),
      dailyCapacity: num(fd, "dailyCapacity", existing.dailyCapacity),
      operatingHoursStart: start,
      operatingHoursEnd: end,
    },
  });

  await logAudit(g.user, {
    action: "department.update",
    resourceType: "Department",
    resourceId: id,
    resourceLabel: updated.name,
    branchId: existing.branchId,
    departmentId: id,
    oldValue: {
      name: existing.name, status: existing.status,
      targetWaitMinutes: existing.targetWaitMinutes, dailyCapacity: existing.dailyCapacity,
      hours: `${existing.operatingHoursStart}-${existing.operatingHoursEnd}`,
    },
    newValue: {
      name: updated.name, status: updated.status,
      targetWaitMinutes: updated.targetWaitMinutes, dailyCapacity: updated.dailyCapacity,
      hours: `${updated.operatingHoursStart}-${updated.operatingHoursEnd}`,
    },
    riskLevel: "MEDIUM",
    reason: strOrNull(fd, "reason") ?? undefined,
  });

  revalidate(existing.branchId, id);
  return { success: true };
}

// ── Machines ──

export async function createMachine(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const departmentId = str(fd, "departmentId");
  const department = await db.department.findUnique({ where: { id: departmentId } });
  if (!department) return { error: "Department not found." };
  if (!branchAllowed(g.user, department.branchId)) return { error: "You cannot modify another branch." };

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Machine name is required." };

  const machine = await db.machine.create({
    data: {
      departmentId,
      name,
      model: strOrNull(fd, "model"),
      serialNumber: strOrNull(fd, "serialNumber"),
      installedAt: new Date(),
    },
  });

  await logAudit(g.user, {
    action: "machine.create",
    resourceType: "Machine",
    resourceId: machine.id,
    resourceLabel: machine.name,
    branchId: department.branchId,
    departmentId,
    newValue: { name, model: machine.model },
    riskLevel: "LOW",
  });

  revalidate(department.branchId, departmentId);
  return { success: true };
}

export async function setMachineStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const id = str(fd, "machineId");
  const status = str(fd, "status");
  if (!MACHINE_STATUSES.includes(status as (typeof MACHINE_STATUSES)[number])) return { error: "Invalid machine status." };

  const machine = await db.machine.findUnique({ where: { id }, include: { department: true } });
  if (!machine) return { error: "Machine not found." };
  if (!branchAllowed(g.user, machine.department.branchId)) return { error: "You cannot modify another branch." };

  await db.machine.update({
    where: { id },
    data: {
      status,
      lastMaintenanceAt: status === "MAINTENANCE" ? new Date() : machine.lastMaintenanceAt,
      notes: strOrNull(fd, "reason") ?? machine.notes,
    },
  });

  await logAudit(g.user, {
    action: "machine.status",
    resourceType: "Machine",
    resourceId: id,
    resourceLabel: machine.name,
    branchId: machine.department.branchId,
    departmentId: machine.departmentId,
    oldValue: { status: machine.status },
    newValue: { status },
    reason: strOrNull(fd, "reason") ?? undefined,
    riskLevel: status === "OFFLINE" ? "HIGH" : "MEDIUM",
  });

  revalidate(machine.department.branchId, machine.departmentId);
  revalidatePath("/operations/radiology");
  return { success: true };
}

// ── Services (price list per department) ──

export async function createService(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const departmentId = str(fd, "departmentId");
  const department = await db.department.findUnique({ where: { id: departmentId } });
  if (!department) return { error: "Department not found." };
  if (!branchAllowed(g.user, department.branchId)) return { error: "You cannot modify another branch." };

  const name = str(fd, "name");
  const code = str(fd, "code").toUpperCase();
  const basePrice = num(fd, "basePrice", -1);
  if (name.length < 2) return { error: "Service name is required." };
  if (!code) return { error: "Service code is required." };
  if (basePrice < 0) return { error: "Base price must be zero or more." };

  const service = await db.service.create({
    data: {
      departmentId,
      name,
      code,
      basePrice,
      durationMinutes: num(fd, "durationMinutes", 20),
      reportRequired: bool(fd, "reportRequired"),
    },
  });

  await logAudit(g.user, {
    action: "service.create",
    resourceType: "Service",
    resourceId: service.id,
    resourceLabel: `${service.name} (${department.name})`,
    branchId: department.branchId,
    departmentId,
    newValue: { name, code, basePrice, reportRequired: service.reportRequired },
    riskLevel: "MEDIUM",
  });

  revalidate(department.branchId, departmentId);
  return { success: true };
}

export async function updateServicePrice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const id = str(fd, "serviceId");
  const service = await db.service.findUnique({ where: { id }, include: { department: true } });
  if (!service) return { error: "Service not found." };
  if (!branchAllowed(g.user, service.department.branchId)) return { error: "You cannot modify another branch." };

  const basePrice = numOrNull(fd, "basePrice");
  if (basePrice === null || basePrice < 0) return { error: "Enter a valid price." };
  const reason = str(fd, "reason");
  if (!reason) return { error: "A reason is required for price changes." };

  await db.service.update({ where: { id }, data: { basePrice, active: bool(fd, "active") || service.active } });

  await logAudit(g.user, {
    action: "service.price-change",
    resourceType: "Service",
    resourceId: id,
    resourceLabel: service.name,
    branchId: service.department.branchId,
    departmentId: service.departmentId,
    oldValue: { basePrice: service.basePrice },
    newValue: { basePrice },
    reason,
    riskLevel: "HIGH",
  });

  revalidate(service.department.branchId, service.departmentId);
  return { success: true };
}

// ── Pricing windows (time-based pricing, e.g. MRI/CT day vs evening) ──

export async function createPricingWindow(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const departmentId = str(fd, "departmentId");
  const department = await db.department.findUnique({ where: { id: departmentId } });
  if (!department) return { error: "Department not found." };
  if (!branchAllowed(g.user, department.branchId)) return { error: "You cannot modify another branch." };

  const name = str(fd, "name");
  const startTime = str(fd, "startTime");
  const endTime = str(fd, "endTime");
  const priceMultiplier = num(fd, "priceMultiplier", 1);
  if (!name) return { error: "Window name is required." };
  if (!isValidTime(startTime) || !isValidTime(endTime)) return { error: "Times must be HH:MM (24h)." };
  if (priceMultiplier <= 0 || priceMultiplier > 5) return { error: "Multiplier must be between 0 and 5." };

  const window = await db.pricingWindow.create({
    data: { departmentId, name, startTime, endTime, priceMultiplier },
  });

  await logAudit(g.user, {
    action: "pricing-window.create",
    resourceType: "PricingWindow",
    resourceId: window.id,
    resourceLabel: `${name} (${department.name})`,
    branchId: department.branchId,
    departmentId,
    newValue: { name, startTime, endTime, priceMultiplier },
    riskLevel: "HIGH",
  });

  revalidate(department.branchId, departmentId);
  revalidatePath("/operations/radiology");
  return { success: true };
}

export async function deletePricingWindow(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const id = str(fd, "windowId");
  const window = await db.pricingWindow.findUnique({ where: { id }, include: { department: true } });
  if (!window) return { error: "Pricing window not found." };
  if (!branchAllowed(g.user, window.department.branchId)) return { error: "You cannot modify another branch." };

  await db.pricingWindow.delete({ where: { id } });

  await logAudit(g.user, {
    action: "pricing-window.delete",
    resourceType: "PricingWindow",
    resourceId: id,
    resourceLabel: `${window.name} (${window.department.name})`,
    branchId: window.department.branchId,
    departmentId: window.departmentId,
    oldValue: { name: window.name, startTime: window.startTime, endTime: window.endTime, priceMultiplier: window.priceMultiplier },
    riskLevel: "HIGH",
  });

  revalidate(window.department.branchId, window.departmentId);
  return { success: true };
}

// ── Service recipes (expected consumables per test) ──

export async function addRecipeItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const serviceId = str(fd, "serviceId");
  const inventoryItemId = str(fd, "inventoryItemId");
  const quantity = num(fd, "quantity", 0);
  if (quantity <= 0) return { error: "Quantity must be greater than zero." };

  const service = await db.service.findUnique({ where: { id: serviceId }, include: { department: true } });
  if (!service) return { error: "Service not found." };
  if (!branchAllowed(g.user, service.department.branchId)) return { error: "You cannot modify another branch." };

  const item = await db.inventoryItem.findUnique({ where: { id: inventoryItemId } });
  if (!item || item.branchId !== service.department.branchId) {
    return { error: "Inventory item must belong to the same branch." };
  }

  const recipe = await db.serviceRecipeItem.create({
    data: { serviceId, inventoryItemId, quantity, optional: bool(fd, "optional") },
  });

  await logAudit(g.user, {
    action: "service.recipe-add",
    resourceType: "ServiceRecipeItem",
    resourceId: recipe.id,
    resourceLabel: `${service.name} ← ${item.name} ×${quantity}`,
    branchId: service.department.branchId,
    departmentId: service.departmentId,
    newValue: { service: service.name, item: item.name, quantity, optional: recipe.optional },
    riskLevel: "LOW",
  });

  revalidate(service.department.branchId, service.departmentId);
  return { success: true };
}

export async function removeRecipeItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("departments");
  if (g.error) return g.error;

  const id = str(fd, "recipeItemId");
  const recipe = await db.serviceRecipeItem.findUnique({
    where: { id },
    include: { service: { include: { department: true } }, inventoryItem: true },
  });
  if (!recipe) return { error: "Recipe item not found." };
  if (!branchAllowed(g.user, recipe.service.department.branchId)) return { error: "You cannot modify another branch." };

  await db.serviceRecipeItem.delete({ where: { id } });

  await logAudit(g.user, {
    action: "service.recipe-remove",
    resourceType: "ServiceRecipeItem",
    resourceId: id,
    resourceLabel: `${recipe.service.name} ✕ ${recipe.inventoryItem.name}`,
    branchId: recipe.service.department.branchId,
    departmentId: recipe.service.departmentId,
    oldValue: { item: recipe.inventoryItem.name, quantity: recipe.quantity },
    riskLevel: "LOW",
  });

  revalidate(recipe.service.department.branchId, recipe.service.departmentId);
  return { success: true };
}
