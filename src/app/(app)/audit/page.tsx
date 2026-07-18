import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText, X } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { DescriptionList } from "@/components/ui/description-list";

export const metadata: Metadata = { title: "Audit Logs" };

const PAGE_SIZE = 40;

type Search = {
  q?: string; risk?: string; result?: string; branch?: string; type?: string;
  user?: string; page?: string; event?: string;
};

function riskTone(risk: string) {
  return risk === "HIGH" ? "critical" : risk === "MEDIUM" ? "warning" : "neutral";
}

function DiffBlock({ label, json }: { label: string; json: string | null }) {
  if (!json) return null;
  let pretty = json;
  try {
    pretty = JSON.stringify(JSON.parse(json), null, 2);
  } catch { /* keep raw */ }
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">{label}</p>
      <pre className="max-h-56 overflow-auto thin-scroll rounded-md bg-canvas-soft-2 p-2.5 font-mono text-[11px] leading-relaxed text-body">{pretty}</pre>
    </div>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("audit");
  const scope = await getScope(user);
  const sp = await searchParams;

  const where = {
    OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.risk ? { riskLevel: sp.risk } : {}),
    ...(sp.result ? { result: sp.result } : {}),
    ...(sp.type ? { resourceType: sp.type } : {}),
    ...(sp.user ? { userName: { contains: sp.user } } : {}),
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
  const [total, events, branches, resourceTypes, high24h, denied7d] = await Promise.all([
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditEvent.findMany({ distinct: ["resourceType"], select: { resourceType: true }, orderBy: { resourceType: "asc" } }),
    db.auditEvent.count({ where: { riskLevel: "HIGH", createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    db.auditEvent.count({ where: { result: "DENIED", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
  ]);

  const selected = sp.event ? await db.auditEvent.findUnique({ where: { id: sp.event } }) : null;
  const relatedChain = selected?.resourceId
    ? await db.auditEvent.findMany({
        where: { resourceType: selected.resourceType, resourceId: selected.resourceId, id: { not: selected.id } },
        orderBy: { createdAt: "desc" },
        take: 8,
      })
    : [];

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...overrides })) if (v) params.set(k, v);
    return `/audit?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only record of every action in the system. Events cannot be edited or deleted — corrections happen as new events."
        actions={<ExportCsvButton filename="merna-audit.csv" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Events on record" value={fmtNumber(total)} />
        <KpiCard label="High-risk (24h)" value={fmtNumber(high24h)} tone={high24h > 0 ? "warning" : undefined} />
        <KpiCard label="Denied attempts (7d)" value={fmtNumber(denied7d)} tone={denied7d > 0 ? "warning" : undefined} />
        <KpiCard label="Integrity" value="Append-only" definition="No update or delete paths exist for audit events in the application layer." />
      </div>

      <Toolbar>
        <SearchInput placeholder="Search action, resource, user, reason…" className="w-full sm:w-72" />
        <FilterSelect param="risk" label="Risk" allLabel="All risk levels" options={[
          { value: "HIGH", label: "High" }, { value: "MEDIUM", label: "Medium" }, { value: "LOW", label: "Low" },
        ]} />
        <FilterSelect param="result" label="Result" allLabel="All results" options={[
          { value: "SUCCESS", label: "Success" }, { value: "DENIED", label: "Denied" }, { value: "FAILURE", label: "Failure" },
        ]} />
        <FilterSelect param="type" label="Resource" allLabel="All resources" options={resourceTypes.map((t) => ({ value: t.resourceType, label: t.resourceType }))} />
        {branches.length > 1 && (
          <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        )}
      </Toolbar>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className={selected ? "xl:col-span-2" : "xl:col-span-3"}>
          {events.length === 0 ? (
            <EmptyState
              icon={<ScrollText size={18} strokeWidth={1.5} />}
              title="No events match"
              description="Adjust the filters — every login, change and denied attempt is recorded here."
            />
          ) : (
            <>
              <div id="export-region">
                <TableShell dense>
                  <THead>
                    <Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Resource</Th><Th>Risk</Th><Th>Result</Th>
                  </THead>
                  <tbody>
                    {events.length === 0 && <TableEmpty colSpan={6}>No events.</TableEmpty>}
                    {events.map((e) => (
                      <Tr key={e.id} className={selected?.id === e.id ? "bg-canvas-soft" : undefined}>
                        <Td className="whitespace-nowrap text-mute">
                          <Link href={makeHref({ event: e.id })} className="hover:text-ink hover:underline">
                            {fmtDateTime(e.createdAt)}
                          </Link>
                        </Td>
                        <Td>
                          {e.userName}
                          <span className="block text-[10px] text-mute">{e.role.replace(/_/g, " ").toLowerCase()}</span>
                        </Td>
                        <Td mono>
                          <Link href={makeHref({ event: e.id })} className="hover:underline">{e.action}</Link>
                        </Td>
                        <Td className="max-w-52">
                          <span className="block truncate">{e.resourceLabel ?? e.resourceType}</span>
                          <span className="block font-mono text-[10px] text-mute">{e.resourceType}</span>
                        </Td>
                        <Td><Badge tone={riskTone(e.riskLevel)}>{e.riskLevel.toLowerCase()}</Badge></Td>
                        <Td><Badge tone={statusTone(e.result)}>{e.result.toLowerCase()}</Badge></Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
              </div>
              <Pagination page={page} pageCount={pageCount} total={total} makeHref={(p) => makeHref({ page: String(p) })} />
            </>
          )}
        </div>

        {selected && (
          <div className="rounded-lg bg-canvas p-4 shadow-raised">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[13px] font-semibold text-ink">{selected.action}</p>
                <p className="text-[11.5px] text-mute">Event {selected.id.slice(0, 12)}…</p>
              </div>
              <Link href={makeHref({ event: undefined })} aria-label="Close detail" className="rounded-md p-1 text-mute hover:bg-canvas-soft-2 hover:text-ink">
                <X size={15} />
              </Link>
            </div>
            <DescriptionList
              columns={1}
              items={[
                { label: "When", value: fmtDateTime(selected.createdAt) },
                { label: "User", value: `${selected.userName} (${selected.role.replace(/_/g, " ").toLowerCase()})` },
                { label: "Resource", value: `${selected.resourceType}${selected.resourceLabel ? ` — ${selected.resourceLabel}` : ""}` },
                { label: "Result / risk", value: `${selected.result.toLowerCase()} · ${selected.riskLevel.toLowerCase()} risk` },
                { label: "Reason", value: selected.reason ?? "—" },
                { label: "Network", value: selected.ip ?? "Not recorded" },
              ]}
            />
            <div className="mt-3 space-y-3">
              <DiffBlock label="Before" json={selected.oldValue} />
              <DiffBlock label="After" json={selected.newValue} />
            </div>
            {relatedChain.length > 0 && (
              <div className="mt-4 border-t border-hairline pt-3">
                <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Related events (same resource)</p>
                <ul className="space-y-1.5">
                  {relatedChain.map((r) => (
                    <li key={r.id} className="text-[12px]">
                      <Link href={makeHref({ event: r.id })} className="font-mono text-link hover:underline">{r.action}</Link>
                      <span className="ml-1.5 text-mute">{fmtDateTime(r.createdAt)} · {r.userName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
