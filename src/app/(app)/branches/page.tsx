import type { Metadata } from "next";
import Link from "next/link";
import { Building2, GitCompareArrows, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { branchOverviews } from "@/lib/analytics/metrics";
import { fmtIQDCompact, fmtDuration, fmtPercent, relativeTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableShell, THead, Th, ThSort, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { ScoreRing } from "@/components/ui/viz";
import { BRANCH_STATUSES, BRANCH_STATUS_LABELS } from "@/types/enums";
import { createBranch } from "./actions";
import { BranchFields } from "./branch-fields";

export const metadata: Metadata = { title: "Branches" };

type Search = { q?: string; status?: string; city?: string; sort?: string; dir?: string; health?: string };

export default async function BranchesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("branches");
  const scope = await getScope(user);
  const sp = await searchParams;

  let rows = await branchOverviews(scope.branchIds, scope);

  // Filters
  const q = (sp.q ?? "").toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.city.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  if (sp.status) rows = rows.filter((r) => r.status === sp.status);
  if (sp.city) rows = rows.filter((r) => r.city === sp.city);
  if (sp.health === "attention") rows = rows.filter((r) => (r.health.total ?? 100) < 75 || r.criticalAlerts > 0);

  // Sort
  const sort = sp.sort ?? "health";
  const dir = sp.dir === "asc" ? 1 : -1;
  const val = (r: (typeof rows)[number]): number | string => {
    switch (sort) {
      case "name": return r.name;
      case "revenue": return r.revenue;
      case "net": return r.net;
      case "visits": return r.visits;
      case "employees": return r.employees;
      case "attendance": return r.attendanceRate ?? -1;
      case "wait": return r.avgWait ?? -1;
      case "backlog": return r.reportBacklog;
      case "waste": return r.wasteRate ?? -1;
      case "alerts": return r.criticalAlerts;
      default: return r.health.total ?? -1;
    }
  };
  rows.sort((a, b) => {
    const av = val(a); const bv = val(b);
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return ((av as number) - (bv as number)) * dir;
  });

  const cities = [...new Set(rows.map((r) => r.city))].sort();
  const makeHref = (s: string, d: string) => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.status) params.set("status", sp.status);
    if (sp.city) params.set("city", sp.city);
    if (sp.health) params.set("health", sp.health);
    params.set("sort", s);
    params.set("dir", d);
    return `/branches?${params.toString()}`;
  };

  const writable = canWrite(user.role, "branches") && !isBranchScoped(user.role);

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Every connected branch of the group — performance, workforce, operations and risk in one directory."
        actions={
          <>
            <ExportCsvButton filename="merna-branches.csv" />
            {writable && (
              <ActionDialog
                trigger={<><Plus size={14} /> New branch</>}
                triggerVariant="primary"
                title="Add a branch"
                description="Creates a new branch of the company. Departments, employees and inventory are added from the branch page."
                action={createBranch}
                submitLabel="Create branch"
                wide
              >
                <BranchFields />
              </ActionDialog>
            )}
          </>
        }
      />

      {rows.length === 0 && !q && !sp.status && !sp.city ? (
        <EmptyState
          icon={<Building2 size={18} strokeWidth={1.5} />}
          title="No branches yet"
          description={writable
            ? "Add the first branch of Merna Medical Company to start operating the control center."
            : "No branches are visible in your current scope."}
          action={writable ? (
            <ActionDialog
              trigger={<><Plus size={14} /> Add first branch</>}
              triggerVariant="primary"
              title="Add a branch"
              action={createBranch}
              submitLabel="Create branch"
              wide
            >
              <BranchFields />
            </ActionDialog>
          ) : undefined}
        />
      ) : (
        <form action="/branches/compare" method="GET">
          <Toolbar>
            <SearchInput placeholder="Search branch, city, code…" className="w-full sm:w-64" />
            <FilterSelect
              param="status"
              label="Status filter"
              allLabel="All statuses"
              options={BRANCH_STATUSES.map((s) => ({ value: s, label: BRANCH_STATUS_LABELS[s] }))}
            />
            <FilterSelect
              param="city"
              label="City filter"
              allLabel="All cities"
              options={cities.map((c) => ({ value: c, label: c }))}
            />
            <FilterSelect
              param="health"
              label="Health filter"
              allLabel="All health"
              options={[{ value: "attention", label: "Needs attention" }]}
            />
            <div className="flex-1" />
            {!isBranchScoped(user.role) && (
              <Button type="submit" variant="secondary" size="sm">
                <GitCompareArrows size={13} />
                Compare selected
              </Button>
            )}
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                {!isBranchScoped(user.role) && <Th className="w-8"><span className="sr-only">Select</span></Th>}
                <ThSort label="Branch" sortKey="name" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} />
                <Th>Status</Th>
                <ThSort label="Health" sortKey="health" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="center" />
                <ThSort label="Revenue" sortKey="revenue" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Net" sortKey="net" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Visits" sortKey="visits" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Employees" sortKey="employees" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Attendance" sortKey="attendance" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Avg wait" sortKey="wait" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Backlog" sortKey="backlog" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Waste" sortKey="waste" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <ThSort label="Critical" sortKey="alerts" currentSort={sort} currentDir={sp.dir} makeHref={makeHref} align="right" />
                <Th align="right">Last activity</Th>
              </THead>
              <tbody>
                {rows.length === 0 && <TableEmpty colSpan={14}>No branches match the current filters.</TableEmpty>}
                {rows.map((r) => (
                  <Tr key={r.id} highlight={r.criticalAlerts > 0}>
                    {!isBranchScoped(user.role) && (
                      <Td>
                        <input
                          type="checkbox"
                          name="ids"
                          value={r.id}
                          aria-label={`Select ${r.name} for comparison`}
                          className="h-3.5 w-3.5"
                        />
                      </Td>
                    )}
                    <Td>
                      <Link href={`/branches/${r.id}`} className="font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                      <span className="block text-[11px] text-mute">{r.city} · {r.code}</span>
                    </Td>
                    <Td><Badge tone={statusTone(r.status)} dot>{BRANCH_STATUS_LABELS[r.status as keyof typeof BRANCH_STATUS_LABELS] ?? r.status}</Badge></Td>
                    <Td align="center">
                      {r.health.total !== null ? <ScoreRing score={r.health.total} size={40} /> : <span className="text-mute">—</span>}
                    </Td>
                    <Td align="right">{fmtIQDCompact(r.revenue)}</Td>
                    <Td align="right" className={r.net < 0 ? "text-critical-deep" : undefined}>{fmtIQDCompact(r.net)}</Td>
                    <Td align="right">{fmtNumber(r.visits)}</Td>
                    <Td align="right">{fmtNumber(r.employees)}</Td>
                    <Td align="right">{r.attendanceRate !== null ? fmtPercent(r.attendanceRate) : "—"}</Td>
                    <Td align="right">{r.avgWait !== null ? fmtDuration(r.avgWait) : "—"}</Td>
                    <Td align="right">{fmtNumber(r.reportBacklog)}</Td>
                    <Td align="right">{r.wasteRate !== null ? fmtPercent(r.wasteRate) : "—"}</Td>
                    <Td align="right">
                      {r.criticalAlerts > 0 ? <Badge tone="critical">{r.criticalAlerts}</Badge> : <span className="text-mute">0</span>}
                    </Td>
                    <Td align="right" className="text-mute">{relativeTime(r.lastActivity)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </form>
      )}
    </>
  );
}
