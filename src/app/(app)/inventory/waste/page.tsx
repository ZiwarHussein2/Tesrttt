import type { Metadata } from "next";
import Link from "next/link";
import { PackageX, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDateTime, fmtIQDCompact, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { HBarList } from "@/components/ui/viz";
import { inventoryStats } from "@/lib/analytics/metrics";

export const metadata: Metadata = { title: "Waste & Variance" };

export default async function WastePage() {
  const user = await requireUser("waste");
  const scope = await getScope(user);

  const [stats, wasteMovements, corrections, expectedVsActual] = await Promise.all([
    inventoryStats(scope.branchIds, scope),
    db.inventoryMovement.findMany({
      where: { branchId: { in: scope.branchIds }, type: "WASTED", occurredAt: { gte: scope.from, lt: scope.to } },
      include: {
        item: { select: { name: true, unit: true, unitCost: true, department: { select: { name: true } } } },
        branch: { select: { name: true } },
        visit: { select: { visitNumber: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 50,
    }),
    db.inventoryMovement.findMany({
      where: { branchId: { in: scope.branchIds }, type: "CORRECTED", occurredAt: { gte: scope.from, lt: scope.to } },
      include: {
        item: { select: { name: true, unit: true, department: { select: { name: true } } } },
        branch: { select: { name: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 30,
    }),
    // Expected consumption (from recipes on completed scans) vs recorded consumption
    db.visit.findMany({
      where: {
        branchId: { in: scope.branchIds },
        scanCompletedAt: { gte: scope.from, lt: scope.to },
        serviceId: { not: null },
      },
      select: {
        serviceId: true,
        service: { select: { name: true, recipeItems: { where: { optional: false }, select: { inventoryItemId: true, quantity: true, inventoryItem: { select: { name: true } } } } } },
      },
    }),
  ]);

  // Aggregate expected per item
  const expected = new Map<string, { name: string; qty: number }>();
  for (const v of expectedVsActual) {
    for (const r of v.service?.recipeItems ?? []) {
      const cur = expected.get(r.inventoryItemId) ?? { name: r.inventoryItem.name, qty: 0 };
      cur.qty += r.quantity;
      expected.set(r.inventoryItemId, cur);
    }
  }
  const consumedByItem = await db.inventoryMovement.groupBy({
    by: ["itemId"],
    where: { branchId: { in: scope.branchIds }, type: { in: ["CONSUMED", "ISSUED"] }, occurredAt: { gte: scope.from, lt: scope.to } },
    _sum: { quantity: true },
  });
  const consumedMap = new Map(consumedByItem.map((c) => [c.itemId, Math.abs(c._sum.quantity ?? 0)]));

  const varianceRows = [...expected.entries()]
    .map(([itemId, e]) => {
      const actual = consumedMap.get(itemId) ?? 0;
      const variance = actual - e.qty;
      const pct = e.qty > 0 ? (variance / e.qty) * 100 : null;
      return { itemId, name: e.name, expected: e.qty, actual, variance, pct };
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  // Waste by branch/department
  const wasteByBranch = new Map<string, number>();
  const wasteByDept = new Map<string, number>();
  for (const w of wasteMovements) {
    const cost = Math.abs(w.quantity) * w.item.unitCost;
    wasteByBranch.set(w.branch.name, (wasteByBranch.get(w.branch.name) ?? 0) + cost);
    const dep = w.item.department?.name ?? "Branch-wide";
    wasteByDept.set(dep, (wasteByDept.get(dep) ?? 0) + cost);
  }

  // Neutral risk signals
  const afterHoursMovements = [...wasteMovements, ...corrections].filter((m) => {
    const h = m.occurredAt.getHours();
    return h < 7 || h >= 22;
  }).length;
  const repeatPairs = new Map<string, number>();
  for (const c of corrections) {
    const key = `${c.recordedByName}|${c.verifiedByName ?? "—"}`;
    repeatPairs.set(key, (repeatPairs.get(key) ?? 0) + 1);
  }
  const repeatedPairCount = [...repeatPairs.values()].filter((n) => n >= 3).length;
  const missingVerification = corrections.filter((c) => !c.verifiedByName).length;
  const highVariance = varianceRows.filter((r) => r.pct !== null && Math.abs(r.pct) > 15).length;

  const hasData = wasteMovements.length > 0 || corrections.length > 0 || varianceRows.length > 0;

  return (
    <>
      <PageHeader
        title="Waste & Variance"
        subtitle="Waste cost, expected-vs-actual consumption and correction patterns. Indicators are neutral — they mark items for review, not accusations."
        actions={
          <>
            <ExportCsvButton filename="merna-waste.csv" />
            <Link
              href={`/merna-ai?prompt=${encodeURIComponent("Analyze inventory waste and variance patterns in the current period and suggest what management should review")}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] font-medium text-violet-deep transition-colors hover:border-violet hover:bg-ai-soft"
            >
              <Sparkles size={13} /> Ask Merna AI
            </Link>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Waste cost (period)" value={fmtIQDCompact(stats.wasteCost)} tone={stats.wasteCost > 0 ? "warning" : undefined} />
        <KpiCard label="Waste rate" value={stats.wasteRate !== null ? fmtPercent(stats.wasteRate) : "—"} definition="Waste ÷ (consumption + waste) by cost." tone={stats.wasteRate !== null && stats.wasteRate > 5 ? "critical" : undefined} />
        <KpiCard label="Corrections (period)" value={fmtNumber(stats.correctionsCount)} />
        <KpiCard label="High-variance items" value={fmtNumber(highVariance)} tone={highVariance > 0 ? "warning" : undefined} definition="Recorded use differs from recipe expectation by more than 15%." />
      </div>

      {!hasData ? (
        <EmptyState
          icon={<PackageX size={18} strokeWidth={1.5} />}
          title="No waste or variance activity in this period"
          description="Waste entries, stock corrections and recipe-based variance appear here as departments operate."
          action={<Link href="/inventory" className="text-[13px] font-medium text-link hover:underline">Open inventory</Link>}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Waste cost by branch" />
              <CardBody>
                {wasteByBranch.size === 0 ? (
                  <p className="py-6 text-center text-[13px] text-mute">No waste recorded.</p>
                ) : (
                  <HBarList money items={[...wasteByBranch.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Waste cost by department" />
              <CardBody>
                {wasteByDept.size === 0 ? (
                  <p className="py-6 text-center text-[13px] text-mute">No waste recorded.</p>
                ) : (
                  <HBarList money items={[...wasteByDept.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Review signals" subtitle="Neutral indicators requiring review" />
              <CardBody className="space-y-2.5 text-[12.5px]">
                <SignalRow label="After-hours waste/corrections" value={afterHoursMovements} />
                <SignalRow label="Corrections without verification" value={missingVerification} />
                <SignalRow label="Repeated recorder/verifier pairs (≥3)" value={repeatedPairCount} />
                <SignalRow label="Variance above 15% threshold" value={highVariance} />
              </CardBody>
            </Card>
          </div>

          <Card className="mb-4">
            <CardHeader
              title="Expected vs recorded consumption"
              subtitle="Recipe expectation from completed scans against recorded stock usage in the period"
            />
            <div id="export-region">
              <TableShell className="rounded-t-none shadow-none" dense>
                <THead>
                  <Th>Item</Th><Th align="right">Expected use</Th><Th align="right">Recorded use</Th>
                  <Th align="right">Variance</Th><Th align="right">Variance %</Th><Th>Review</Th>
                </THead>
                <tbody>
                  {varianceRows.length === 0 && (
                    <TableEmpty colSpan={6}>
                      No recipe-based expectations yet — define expected assets per service on department pages.
                    </TableEmpty>
                  )}
                  {varianceRows.map((r) => {
                    const flag = r.pct !== null && Math.abs(r.pct) > 15;
                    return (
                      <Tr key={r.itemId} highlight={flag}>
                        <Td className="font-medium text-ink">{r.name}</Td>
                        <Td align="right">{fmtNumber(r.expected, 1)}</Td>
                        <Td align="right">{fmtNumber(r.actual, 1)}</Td>
                        <Td align="right" className={r.variance > 0 ? "text-warning-deep" : undefined}>
                          {r.variance > 0 ? "+" : ""}{fmtNumber(r.variance, 1)}
                        </Td>
                        <Td align="right">{r.pct !== null ? fmtPercent(r.pct, 0) : "—"}</Td>
                        <Td>{flag ? <Badge tone="warning">Requires review</Badge> : <Badge tone="good">Within threshold</Badge>}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </TableShell>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Waste entries" subtitle="Latest 50 in period" />
              <TableShell className="rounded-t-none shadow-none" dense>
                <THead>
                  <Th>When</Th><Th>Item</Th><Th align="right">Qty</Th><Th align="right">Cost</Th><Th>By</Th>
                </THead>
                <tbody>
                  {wasteMovements.length === 0 && <TableEmpty colSpan={5}>No waste entries.</TableEmpty>}
                  {wasteMovements.map((w) => (
                    <Tr key={w.id}>
                      <Td className="whitespace-nowrap text-mute">{fmtDateTime(w.occurredAt)}</Td>
                      <Td>
                        <span className="font-medium text-ink">{w.item.name}</span>
                        <span className="block text-[10.5px] text-mute">{w.branch.name} · {w.reason ?? "—"}</span>
                      </Td>
                      <Td align="right">{fmtNumber(Math.abs(w.quantity), 1)} {w.item.unit}</Td>
                      <Td align="right">{fmtIQDCompact(Math.abs(w.quantity) * w.item.unitCost)}</Td>
                      <Td className="text-mute">{w.recordedByName}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </Card>

            <Card>
              <CardHeader title="Stock corrections" subtitle="Manual adjustments to physical counts" />
              <TableShell className="rounded-t-none shadow-none" dense>
                <THead>
                  <Th>When</Th><Th>Item</Th><Th align="right">Adjustment</Th><Th>Recorded / verified</Th>
                </THead>
                <tbody>
                  {corrections.length === 0 && <TableEmpty colSpan={4}>No corrections in this period.</TableEmpty>}
                  {corrections.map((c) => (
                    <Tr key={c.id}>
                      <Td className="whitespace-nowrap text-mute">{fmtDateTime(c.occurredAt)}</Td>
                      <Td>
                        <span className="font-medium text-ink">{c.item.name}</span>
                        <span className="block text-[10.5px] text-mute">{c.branch.name} · {c.reason ?? "—"}</span>
                      </Td>
                      <Td align="right" className={c.quantity < 0 ? "text-critical-deep" : "text-good-deep"}>
                        {c.quantity > 0 ? "+" : ""}{fmtNumber(c.quantity, 1)} {c.item.unit}
                      </Td>
                      <Td className="text-[11.5px] text-mute">
                        {c.recordedByName} / {c.verifiedByName ?? <Badge tone="warning">Unverified</Badge>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function SignalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
      <span className="text-body">{label}</span>
      <Badge tone={value > 0 ? "warning" : "good"}>{value}</Badge>
    </div>
  );
}
