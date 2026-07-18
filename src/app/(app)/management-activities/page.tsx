import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { HBarList } from "@/components/ui/viz";

export const metadata: Metadata = { title: "Management Activities" };

const PAGE_SIZE = 30;

type Search = { q?: string; branch?: string; risk?: string; page?: string };

// Management activities are the medium/high-risk slice of the audit trail:
// price changes, discount decisions, corrections, role changes, deal changes…
export default async function ManagementActivitiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("management-activities");
  const scope = await getScope(user);
  const sp = await searchParams;

  const where = {
    riskLevel: sp.risk ? sp.risk : { in: ["MEDIUM", "HIGH"] },
    OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.q
      ? {
          AND: [{
            OR: [
              { action: { contains: sp.q } },
              { resourceLabel: { contains: sp.q } },
              { userName: { contains: sp.q } },
              { reason: { contains: sp.q } },
            ],
          }],
        }
      : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, events, branches, periodEvents] = await Promise.all([
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditEvent.findMany({
      where: {
        riskLevel: { in: ["MEDIUM", "HIGH"] },
        OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
        createdAt: { gte: scope.from, lt: scope.to },
      },
      select: { action: true, riskLevel: true, userName: true, role: true, branchId: true, createdAt: true, reason: true },
    }),
  ]);

  const branchNames = new Map(branches.map((b) => [b.id, b.name]));

  // Insights over the selected period
  const highImpact = periodEvents.filter((e) => e.riskLevel === "HIGH").length;
  const afterHours = periodEvents.filter((e) => {
    const h = e.createdAt.getHours();
    return h < 7 || h >= 22;
  }).length;
  const priceChanges = periodEvents.filter((e) => e.action.includes("price")).length;
  const discountActivity = periodEvents.filter((e) => e.action.startsWith("discount")).length;
  const corrections = periodEvents.filter((e) => e.action.includes("correct")).length;

  const byAction = new Map<string, number>();
  const byRole = new Map<string, number>();
  const byBranch = new Map<string, number>();
  for (const e of periodEvents) {
    const family = e.action.split(".")[0];
    byAction.set(family, (byAction.get(family) ?? 0) + 1);
    byRole.set(e.role.replace(/_/g, " ").toLowerCase(), (byRole.get(e.role) ?? 0) + 1);
    byBranch.set(e.branchId ? branchNames.get(e.branchId) ?? "Other" : "Group", (byBranch.get(e.branchId ? branchNames.get(e.branchId) ?? "Other" : "Group") ?? 0) + 1);
  }

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/management-activities?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Management Activities"
        subtitle="High-impact administrative actions: price changes, discounts, corrections, role and deal changes — with old/new values and reasons."
        actions={<ExportCsvButton filename="merna-management-activities.csv" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Activities (period)" value={fmtNumber(periodEvents.length)} />
        <KpiCard label="High-impact" value={fmtNumber(highImpact)} tone={highImpact > 0 ? "warning" : undefined} />
        <KpiCard label="Outside normal hours" value={fmtNumber(afterHours)} tone={afterHours > 0 ? "warning" : undefined} definition="Before 07:00 or after 22:00." />
        <KpiCard label="Price changes" value={fmtNumber(priceChanges)} />
        <KpiCard label="Repeated corrections" value={fmtNumber(corrections)} definition="Attendance and inventory correction events in period." />
      </div>

      {periodEvents.length === 0 && total === 0 ? (
        <EmptyState
          icon={<History size={18} strokeWidth={1.5} />}
          title="No management activity yet"
          description="Medium and high-risk actions appear here automatically as managers work — nothing to configure."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="xl:col-span-3">
            <Toolbar>
              <SearchInput placeholder="Search action, user, reason…" className="w-full sm:w-64" />
              <FilterSelect param="risk" label="Risk" allLabel="Medium + high" options={[
                { value: "HIGH", label: "High only" },
                { value: "MEDIUM", label: "Medium only" },
              ]} />
              {branches.length > 1 && (
                <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              )}
            </Toolbar>

            <div id="export-region">
              <TableShell dense>
                <THead>
                  <Th>Time</Th><Th>User</Th><Th>Activity</Th><Th>Object</Th><Th>Reason</Th><Th>Risk</Th><Th>Result</Th>
                </THead>
                <tbody>
                  {events.length === 0 && <TableEmpty colSpan={7}>No activities match the current filters.</TableEmpty>}
                  {events.map((e) => (
                    <Tr key={e.id}>
                      <Td className="whitespace-nowrap text-mute">
                        <Link href={`/audit?event=${e.id}`} className="hover:text-ink hover:underline">{fmtDateTime(e.createdAt)}</Link>
                      </Td>
                      <Td>
                        {e.userName}
                        <span className="block text-[10px] text-mute">{e.role.replace(/_/g, " ").toLowerCase()}</span>
                      </Td>
                      <Td mono>{e.action}</Td>
                      <Td className="max-w-48"><span className="block truncate">{e.resourceLabel ?? e.resourceType}</span></Td>
                      <Td className="max-w-44"><span className="block truncate" title={e.reason ?? undefined}>{e.reason ?? "—"}</span></Td>
                      <Td><Badge tone={e.riskLevel === "HIGH" ? "critical" : "warning"}>{e.riskLevel.toLowerCase()}</Badge></Td>
                      <Td><Badge tone={statusTone(e.result)}>{e.result.toLowerCase()}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
            <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="By activity family" subtitle="Selected period" />
              <CardBody>
                <HBarList items={[...byAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="By branch" />
              <CardBody>
                <HBarList items={[...byBranch.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Signals" />
              <CardBody className="space-y-2.5 text-[12.5px]">
                <div className="flex items-center justify-between border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                  <span className="text-body">Discount activity</span>
                  <Badge tone={discountActivity > 10 ? "warning" : "neutral"}>{discountActivity}</Badge>
                </div>
                <div className="flex items-center justify-between border-t border-hairline pt-2.5">
                  <span className="text-body">After-hours actions</span>
                  <Badge tone={afterHours > 0 ? "warning" : "good"}>{afterHours}</Badge>
                </div>
                <div className="flex items-center justify-between border-t border-hairline pt-2.5">
                  <span className="text-body">Corrections</span>
                  <Badge tone={corrections > 5 ? "warning" : "neutral"}>{corrections}</Badge>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
