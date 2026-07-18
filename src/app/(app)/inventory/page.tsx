import type { Metadata } from "next";
import { Package, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { inventoryStats } from "@/lib/analytics/metrics";
import { fmtIQD, fmtIQDCompact, fmtNumber, fmtPercent, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, Hint } from "@/components/ui/input";
import {
  INVENTORY_CATEGORIES, INVENTORY_CATEGORY_LABELS, MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS,
} from "@/types/enums";
import { createInventoryItem, recordMovement } from "./actions";

export const metadata: Metadata = { title: "Inventory" };

const PAGE_SIZE = 25;

type Search = { q?: string; category?: string; branch?: string; level?: string; page?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("inventory");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "inventory");

  const stats = await inventoryStats(scope.branchIds, scope);

  const where = {
    branchId: { in: scope.branchIds },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.q ? { name: { contains: sp.q } } : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [totalAll, itemsRaw, branches, departments, pendingReceipts] = await Promise.all([
    db.inventoryItem.count({ where }),
    db.inventoryItem.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        department: { select: { name: true } },
        movements: {
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { occurredAt: true, type: true },
        },
      },
      orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ where: { branchId: { in: scope.branchIds } }, select: { id: true, name: true, branch: { select: { name: true } } }, orderBy: { name: "asc" } }),
    db.inventoryMovement.count({
      where: { branchId: { in: scope.branchIds }, type: "RECEIVED", occurredAt: { gte: scope.from } },
    }),
  ]);

  // Movement aggregates for the period (expected use vs recorded)
  const movementsInPeriod = await db.inventoryMovement.findMany({
    where: { branchId: { in: scope.branchIds }, occurredAt: { gte: scope.from, lt: scope.to } },
    select: { itemId: true, type: true, quantity: true },
  });
  const movAgg = new Map<string, { received: number; consumed: number; wasted: number; corrected: number }>();
  for (const m of movementsInPeriod) {
    if (!movAgg.has(m.itemId)) movAgg.set(m.itemId, { received: 0, consumed: 0, wasted: 0, corrected: 0 });
    const a = movAgg.get(m.itemId)!;
    if (m.type === "RECEIVED" || m.type === "RETURNED") a.received += m.quantity;
    else if (m.type === "CONSUMED" || m.type === "ISSUED") a.consumed += Math.abs(m.quantity);
    else if (m.type === "WASTED") a.wasted += Math.abs(m.quantity);
    else if (m.type === "CORRECTED") a.corrected += m.quantity;
  }

  // Level filter applied in JS (needs computed status)
  let items = itemsRaw;
  if (sp.level === "low") items = items.filter((i) => i.quantity > 0 && i.quantity <= i.minimumLevel);
  if (sp.level === "out") items = items.filter((i) => i.quantity <= 0);
  const total = sp.level ? items.length : totalAll;
  items = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/inventory?${params.toString()}`;
  };

  // Days of cover: current stock ÷ average daily consumption in period
  const periodDays = Math.max(1, Math.round((scope.to.getTime() - scope.from.getTime()) / 86400000));

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Add item</>}
      triggerVariant="primary"
      title="Add inventory item"
      description="Inventory is separate per branch and department — departments do not silently share stock."
      action={createInventoryItem}
      submitLabel="Create item"
      wide
    >
      {!isBranchScoped(user.role) && (
        <div>
          <Label htmlFor="iv-branch" required>Branch</Label>
          <Select id="iv-branch" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="iv-name" required>Item name</Label>
          <Input id="iv-name" name="name" placeholder="MRI Film 35×43" required />
        </div>
        <div>
          <Label htmlFor="iv-cat" required>Category</Label>
          <Select id="iv-cat" name="category" defaultValue="FILM">
            {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{INVENTORY_CATEGORY_LABELS[c]}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="iv-dept">Department</Label>
        <Select id="iv-dept" name="departmentId" defaultValue="">
          <option value="">— Branch-wide —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.branch.name}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="iv-unit">Unit</Label>
          <Input id="iv-unit" name="unit" defaultValue="unit" />
        </div>
        <div>
          <Label htmlFor="iv-qty">Opening qty</Label>
          <Input id="iv-qty" name="quantity" type="number" min={0} step="1" defaultValue={0} />
        </div>
        <div>
          <Label htmlFor="iv-min">Minimum level</Label>
          <Input id="iv-min" name="minimumLevel" type="number" min={0} step="1" defaultValue={0} />
        </div>
        <div>
          <Label htmlFor="iv-cost">Unit cost (IQD)</Label>
          <Input id="iv-cost" name="unitCost" type="number" min={0} step="250" defaultValue={0} />
        </div>
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock, consumption and movements per branch and department. Test recipes consume stock automatically when scans complete."
        actions={<>
          <ExportCsvButton filename="merna-inventory.csv" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Stock value" value={fmtIQDCompact(stats.stockValue)} />
        <KpiCard label="Items tracked" value={fmtNumber(stats.itemCount)} />
        <KpiCard label="Low stock" value={fmtNumber(stats.lowStock)} tone={stats.lowStock > 0 ? "warning" : undefined} />
        <KpiCard label="Out of stock" value={fmtNumber(stats.outOfStock)} tone={stats.outOfStock > 0 ? "critical" : undefined} />
        <KpiCard label="Consumption (period)" value={fmtIQDCompact(stats.consumptionCost)} />
        <KpiCard label="Waste rate" value={stats.wasteRate !== null ? fmtPercent(stats.wasteRate) : "—"} tone={stats.wasteRate !== null && stats.wasteRate > 5 ? "warning" : undefined} definition={`${fmtNumber(pendingReceipts)} receipts recorded in period.`} />
      </div>

      {totalAll === 0 && !sp.q && !sp.category && !sp.branch ? (
        <EmptyState
          icon={<Package size={18} strokeWidth={1.5} />}
          title="No inventory items yet"
          description="Add films, papers, DVDs, envelopes and consumables per branch. Link them to services as test recipes for automatic consumption."
          action={addDialog}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search item…" className="w-full sm:w-56" />
            <FilterSelect param="category" label="Category" allLabel="All categories" options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: INVENTORY_CATEGORY_LABELS[c] }))} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
            <FilterSelect param="level" label="Stock level" allLabel="All levels" options={[
              { value: "low", label: "Low stock" },
              { value: "out", label: "Out of stock" },
            ]} />
          </Toolbar>

          <div id="export-region">
            <TableShell dense>
              <THead>
                <Th>Item</Th><Th>Branch / Department</Th><Th align="right">Stock</Th><Th align="right">Min</Th>
                <Th align="right">Received</Th><Th align="right">Used</Th><Th align="right">Wasted</Th>
                <Th align="right">Days of cover</Th><Th align="right">Unit cost</Th><Th>Status</Th><Th align="right">Last movement</Th>
                {writable && <Th align="right">Move</Th>}
              </THead>
              <tbody>
                {items.length === 0 && <TableEmpty colSpan={writable ? 12 : 11}>No items match the current filters.</TableEmpty>}
                {items.map((i) => {
                  const agg = movAgg.get(i.id) ?? { received: 0, consumed: 0, wasted: 0, corrected: 0 };
                  const dailyUse = agg.consumed / periodDays;
                  const cover = dailyUse > 0 ? i.quantity / dailyUse : null;
                  const status = i.quantity <= 0 ? "OUT" : i.quantity <= i.minimumLevel ? "LOW" : "OK";
                  return (
                    <Tr key={i.id} highlight={status !== "OK"}>
                      <Td>
                        <span className="font-medium text-ink">{i.name}</span>
                        <span className="block text-[10.5px] text-mute">{INVENTORY_CATEGORY_LABELS[i.category as keyof typeof INVENTORY_CATEGORY_LABELS] ?? i.category}</span>
                      </Td>
                      <Td>
                        {i.branch.name}
                        <span className="block text-[10.5px] text-mute">{i.department?.name ?? "Branch-wide"}</span>
                      </Td>
                      <Td align="right" className="font-medium text-ink">{fmtNumber(i.quantity)} {i.unit}</Td>
                      <Td align="right" className="text-mute">{fmtNumber(i.minimumLevel)}</Td>
                      <Td align="right">{fmtNumber(agg.received)}</Td>
                      <Td align="right">{fmtNumber(agg.consumed)}</Td>
                      <Td align="right" className={agg.wasted > 0 ? "text-warning-deep" : undefined}>{fmtNumber(agg.wasted)}</Td>
                      <Td align="right">{cover !== null ? `${Math.floor(cover)}d` : "—"}</Td>
                      <Td align="right">{fmtIQD(i.unitCost)}</Td>
                      <Td>
                        <Badge tone={status === "OK" ? "good" : status === "LOW" ? "warning" : "critical"} dot>
                          {status === "OK" ? "In stock" : status === "LOW" ? "Low" : "Out"}
                        </Badge>
                      </Td>
                      <Td align="right" className="text-mute">
                        {i.movements[0] ? `${MOVEMENT_TYPE_LABELS[i.movements[0].type as keyof typeof MOVEMENT_TYPE_LABELS]} · ${relativeTime(i.movements[0].occurredAt)}` : "—"}
                      </Td>
                      {writable && (
                        <Td align="right">
                          <ActionDialog
                            trigger="Move"
                            triggerSize="sm"
                            title={`Stock movement — ${i.name}`}
                            description={`Current stock: ${fmtNumber(i.quantity)} ${i.unit}. Corrections enter the verified physical count; waste and corrections require a reason.`}
                            action={recordMovement}
                            submitLabel="Record movement"
                          >
                            <input type="hidden" name="itemId" value={i.id} />
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label htmlFor={`mt-${i.id}`} required>Type</Label>
                                <Select id={`mt-${i.id}`} name="type" defaultValue="RECEIVED">
                                  {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>)}
                                </Select>
                              </div>
                              <div>
                                <Label htmlFor={`mq-${i.id}`} required>Quantity</Label>
                                <Input id={`mq-${i.id}`} name="quantity" type="number" min={0} step="0.5" required />
                                <Hint>For corrections: the counted physical quantity.</Hint>
                              </div>
                            </div>
                            <div>
                              <Label htmlFor={`mr-${i.id}`}>Reason</Label>
                              <Textarea id={`mr-${i.id}`} name="reason" placeholder="Required for waste, corrections, transfers and returns" />
                            </div>
                            <div>
                              <Label htmlFor={`mv-${i.id}`}>Verified by</Label>
                              <Input id={`mv-${i.id}`} name="verifiedBy" placeholder="Reception / supervisor name (optional)" />
                            </div>
                          </ActionDialog>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
          <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
        </>
      )}
    </>
  );
}
