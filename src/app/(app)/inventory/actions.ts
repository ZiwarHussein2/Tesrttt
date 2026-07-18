"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardWrite, branchAllowed, resolveBranchId } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { str, strOrNull, num } from "@/lib/form";
import { INVENTORY_CATEGORIES, MOVEMENT_TYPES } from "@/types/enums";
import type { ActionState } from "@/lib/action-state";

function revalidateInventory() {
  revalidatePath("/inventory");
  revalidatePath("/inventory/waste");
  revalidatePath("/dashboard");
}

export async function createInventoryItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("inventory");
  if (g.error) return g.error;

  const branchId = resolveBranchId(g.user, str(fd, "branchId"));
  if (!branchId) return { error: "Branch is required." };
  if (!branchAllowed(g.user, branchId)) return { error: "You cannot modify another branch." };

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Item name is required." };
  const category = str(fd, "category");
  if (!INVENTORY_CATEGORIES.includes(category as (typeof INVENTORY_CATEGORIES)[number])) {
    return { error: "Select a valid category." };
  }
  const unitCost = num(fd, "unitCost", 0);
  if (unitCost < 0) return { error: "Unit cost cannot be negative." };

  const departmentId = strOrNull(fd, "departmentId");
  if (departmentId) {
    const dep = await db.department.findUnique({ where: { id: departmentId } });
    if (!dep || dep.branchId !== branchId) return { error: "Department must belong to the selected branch." };
  }

  const openingQty = Math.max(0, num(fd, "quantity", 0));
  const item = await db.inventoryItem.create({
    data: {
      branchId,
      departmentId,
      name,
      category,
      unit: str(fd, "unit") || "unit",
      quantity: openingQty,
      minimumLevel: Math.max(0, num(fd, "minimumLevel", 0)),
      unitCost,
    },
  });

  if (openingQty > 0) {
    await db.inventoryMovement.create({
      data: {
        itemId: item.id,
        branchId,
        type: "RECEIVED",
        quantity: openingQty,
        reason: "Opening stock",
        recordedByName: g.user.name,
      },
    });
  }

  await logAudit(g.user, {
    action: "inventory.create-item",
    resourceType: "InventoryItem",
    resourceId: item.id,
    resourceLabel: item.name,
    branchId,
    departmentId,
    newValue: { name, category, openingQty, unitCost },
    riskLevel: "LOW",
  });

  revalidateInventory();
  return { success: true };
}

const NEGATIVE_TYPES = new Set(["ISSUED", "CONSUMED", "WASTED", "TRANSFERRED"]);

export async function recordMovement(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardWrite("inventory");
  if (g.error) return g.error;

  const itemId = str(fd, "itemId");
  const item = await db.inventoryItem.findUnique({ where: { id: itemId }, include: { branch: true } });
  if (!item) return { error: "Inventory item not found." };
  if (!branchAllowed(g.user, item.branchId)) return { error: "You cannot modify another branch." };

  const type = str(fd, "type");
  if (!MOVEMENT_TYPES.includes(type as (typeof MOVEMENT_TYPES)[number])) return { error: "Invalid movement type." };

  const rawQty = num(fd, "quantity", 0);
  if (type !== "CORRECTED" && rawQty <= 0) return { error: "Quantity must be greater than zero." };

  const reason = str(fd, "reason");
  if (["WASTED", "CORRECTED", "TRANSFERRED", "RETURNED"].includes(type) && !reason) {
    return { error: "A reason is required for this movement type." };
  }

  let delta: number;
  if (type === "CORRECTED") {
    // The entered quantity is the verified physical count; delta is the adjustment.
    const counted = Math.max(0, rawQty);
    delta = counted - item.quantity;
    if (delta === 0) return { error: "Physical count equals current stock — nothing to correct." };
  } else {
    delta = NEGATIVE_TYPES.has(type) ? -rawQty : rawQty;
  }

  if (item.quantity + delta < 0) {
    return { error: `Stock cannot go negative (current: ${item.quantity} ${item.unit}).` };
  }

  const movement = await db.$transaction(async (tx) => {
    const m = await tx.inventoryMovement.create({
      data: {
        itemId,
        branchId: item.branchId,
        type,
        quantity: delta,
        reason: reason || null,
        recordedByName: g.user.name,
        verifiedByName: strOrNull(fd, "verifiedBy"),
      },
    });
    await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: { increment: delta } } });
    return m;
  });

  const afterHours = (() => {
    const h = new Date().getHours();
    return h < 7 || h >= 22;
  })();

  await logAudit(g.user, {
    action: `inventory.${type.toLowerCase()}`,
    resourceType: "InventoryMovement",
    resourceId: movement.id,
    resourceLabel: `${item.name} ${delta > 0 ? "+" : ""}${delta} ${item.unit}`,
    branchId: item.branchId,
    departmentId: item.departmentId,
    oldValue: { quantity: item.quantity },
    newValue: { quantity: item.quantity + delta, movement: type },
    reason: reason || undefined,
    riskLevel:
      type === "CORRECTED" || type === "WASTED"
        ? afterHours ? "HIGH" : "MEDIUM"
        : "LOW",
  });

  revalidateInventory();
  return { success: true };
}
