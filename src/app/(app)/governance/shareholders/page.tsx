import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, maskingFor } from "@/lib/permissions";
import { branchOverviews, financeSummary } from "@/lib/analytics/metrics";
import { fmtDate, fmtIQDCompact, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Textarea, Hint } from "@/components/ui/input";
import { HBarList } from "@/components/ui/viz";
import { PrintButton } from "@/components/ui/export-button";
import { upsertShareholder } from "../actions";

export const metadata: Metadata = { title: "Shareholders" };

export default async function ShareholdersPage() {
  const user = await requireUser("shareholders");
  const scope = await getScope(user);
  const masking = maskingFor(user.role);
  const writable = canWrite(user.role, "shareholders");

  const [shareholders, fin, prevFin, overviews, meetings, criticalAlerts] = await Promise.all([
    db.shareholder.findMany({ orderBy: { ownershipPercent: "desc" } }),
    financeSummary(scope.branchIds, scope),
    financeSummary(scope.branchIds, { from: scope.prevFrom, to: scope.prevTo }),
    branchOverviews(scope.branchIds, scope),
    db.boardMeeting.findMany({ orderBy: { scheduledAt: "desc" }, take: 5 }),
    db.alert.count({ where: { severity: "CRITICAL", status: { not: "RESOLVED" } } }),
  ]);

  const totalOwnership = shareholders.reduce((s, x) => s + x.ownershipPercent, 0);

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Shareholder</>}
      triggerVariant="primary"
      title="Add shareholder"
      description="Ownership across all shareholders cannot exceed 100%."
      action={upsertShareholder}
      submitLabel="Save"
    >
      <ShareholderFields />
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Shareholders & Governance"
        subtitle="Approved aggregate information for the ownership level: group results, branch contribution, risks and board activity."
        actions={<>
          <PrintButton label="Shareholder PDF" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Group revenue" value={fmtIQDCompact(fin.revenue)} delta={prevFin.revenue ? ((fin.revenue - prevFin.revenue) / prevFin.revenue) * 100 : null} />
        <KpiCard label="Group expenses" value={fmtIQDCompact(fin.expenses)} invertDelta delta={prevFin.expenses ? ((fin.expenses - prevFin.expenses) / prevFin.expenses) * 100 : null} />
        <KpiCard label="Net result" value={fmtIQDCompact(fin.net)} tone={fin.net < 0 ? "critical" : undefined} />
        <KpiCard label="Critical alerts" value={fmtNumber(criticalAlerts)} tone={criticalAlerts > 0 ? "critical" : undefined} definition="Strategic risk indicator — unresolved critical alerts across the group." />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader
            title="Ownership register"
            subtitle={`${fmtPercent(totalOwnership, 1)} allocated`}
          />
          <CardBody>
            {shareholders.length === 0 ? (
              <EmptyState
                icon={<Landmark size={18} strokeWidth={1.5} />}
                title="No shareholders recorded"
                description="Add the ownership structure of the company."
                className="py-8"
              />
            ) : (
              <ul className="space-y-3">
                {shareholders.map((s) => (
                  <li key={s.id} className="border-t border-hairline pt-3 first:border-0 first:pt-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{s.name}</p>
                        <p className="text-[11.5px] text-mute">
                          Voting {fmtPercent(s.votingPercent ?? s.ownershipPercent, 1)}
                          {!masking.employeeContact && s.email ? ` · ${s.email}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-ink">{fmtPercent(s.ownershipPercent, 1)}</span>
                        {writable && (
                          <ActionDialog
                            trigger={<Pencil size={12} />}
                            triggerSize="icon"
                            triggerVariant="ghost"
                            title={`Edit — ${s.name}`}
                            action={upsertShareholder}
                            submitLabel="Save"
                          >
                            <input type="hidden" name="shareholderId" value={s.id} />
                            <ShareholderFields defaults={s} />
                          </ActionDialog>
                        )}
                      </div>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas-soft-2">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${s.ownershipPercent}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Branch contribution" subtitle="Net result by branch (period)" />
          <CardBody>
            {overviews.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-mute">No branches yet.</p>
            ) : (
              <HBarList
                money
                items={overviews
                  .sort((a, b) => b.net - a.net)
                  .map((o) => ({ label: o.name, value: o.net }))}
              />
            )}
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Expansion readiness</p>
              <p className="text-[12.5px] leading-relaxed text-body">
                {overviews.filter((o) => (o.health.total ?? 0) >= 75).length} of {overviews.length} branches at health ≥ 75.
                Architecture supports adding hospitals, laboratories, pharmacies, clinics and warehouses as new branch types.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Board activity"
            actions={<Link href="/governance/board" className="text-[12px] font-medium text-link hover:underline">Board reports</Link>}
          />
          <CardBody>
            {meetings.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-mute">No board meetings scheduled yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {meetings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{m.title}</p>
                      <p className="text-[11.5px] text-mute">{fmtDate(m.scheduledAt)}</p>
                    </div>
                    <Badge tone={statusTone(m.status)} dot>{m.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-hairline pt-3 text-[11.5px] leading-relaxed text-mute">
              Shareholder access is aggregate-only: patient records, employee files, legal evidence and raw security
              data are never visible at this level. Views and report downloads are audit-logged.
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4" id="export-region">
        <Card>
          <CardHeader title="Branch performance summary" subtitle="Aggregate figures approved for shareholder viewing" />
          <TableShell className="rounded-t-none shadow-none">
            <THead>
              <Th>Branch</Th><Th>Status</Th><Th align="right">Health</Th><Th align="right">Revenue</Th>
              <Th align="right">Expenses</Th><Th align="right">Net</Th><Th align="right">Visits</Th><Th align="right">Employees</Th>
            </THead>
            <tbody>
              {overviews.length === 0 && <TableEmpty colSpan={8}>No branches.</TableEmpty>}
              {overviews.map((o) => (
                <Tr key={o.id}>
                  <Td className="font-medium text-ink">{o.name}</Td>
                  <Td><Badge tone={statusTone(o.status)} dot>{o.status.toLowerCase()}</Badge></Td>
                  <Td align="right">{o.health.total !== null ? Math.round(o.health.total) : "—"}</Td>
                  <Td align="right">{fmtIQDCompact(o.revenue)}</Td>
                  <Td align="right">{fmtIQDCompact(o.expenses)}</Td>
                  <Td align="right" className={o.net < 0 ? "text-critical-deep" : undefined}>{fmtIQDCompact(o.net)}</Td>
                  <Td align="right">{fmtNumber(o.visits)}</Td>
                  <Td align="right">{fmtNumber(o.employees)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      </div>
    </>
  );
}

function ShareholderFields({
  defaults,
}: {
  defaults?: { name?: string; ownershipPercent?: number; votingPercent?: number | null; email?: string | null; notes?: string | null };
}) {
  return (
    <>
      <div>
        <Label htmlFor="sh-name" required>Name</Label>
        <Input id="sh-name" name="name" defaultValue={defaults?.name} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sh-own" required>Ownership %</Label>
          <Input id="sh-own" name="ownershipPercent" type="number" min={0} max={100} step="0.1" defaultValue={defaults?.ownershipPercent} required />
        </div>
        <div>
          <Label htmlFor="sh-vote">Voting %</Label>
          <Input id="sh-vote" name="votingPercent" type="number" min={0} max={100} step="0.1" defaultValue={defaults?.votingPercent ?? ""} />
          <Hint>Defaults to ownership %.</Hint>
        </div>
      </div>
      <div>
        <Label htmlFor="sh-email">Email</Label>
        <Input id="sh-email" name="email" type="email" defaultValue={defaults?.email ?? ""} />
      </div>
      <div>
        <Label htmlFor="sh-notes">Notes</Label>
        <Textarea id="sh-notes" name="notes" defaultValue={defaults?.notes ?? ""} />
      </div>
    </>
  );
}
