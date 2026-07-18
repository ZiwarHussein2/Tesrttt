import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Plus, RefreshCw, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { maybeRunAlertScan } from "@/lib/analytics/alerts";
import { fmtDateTime, fmtNumber, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionButton, ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ALERT_CATEGORIES, ALERT_CATEGORY_LABELS, ALERT_SEVERITIES } from "@/types/enums";
import { alertAction, createManualAlert, runAlertScan } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

type Search = { q?: string; category?: string; severity?: string; status?: string; branch?: string };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("alerts");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "alerts");

  // Opportunistic scan (throttled to every 10 minutes).
  await maybeRunAlertScan();

  const where = {
    OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.severity ? { severity: sp.severity } : {}),
    ...(sp.status ? { status: sp.status } : { status: { not: "RESOLVED" } }),
    ...(sp.q ? { title: { contains: sp.q } } : {}),
  };

  const [alerts, branches, openCount, criticalCount, ackCount, resolved7d] = await Promise.all([
    db.alert.findMany({
      where,
      include: { branch: { select: { name: true } }, department: { select: { id: true, name: true } } },
      orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
      take: 100,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.alert.count({ where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: "OPEN" } }),
    db.alert.count({ where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: { not: "RESOLVED" }, severity: "CRITICAL" } }),
    db.alert.count({ where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: "ACKNOWLEDGED" } }),
    db.alert.count({
      where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: "RESOLVED", resolvedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    }),
  ]);

  // Severity ordering: CRITICAL first
  const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as Record<string, number>;
  alerts.sort((a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) || b.detectedAt.getTime() - a.detectedAt.getTime());

  const lastScan = await db.setting.findUnique({ where: { key: "alerts.lastScan" } });

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={`Threshold monitoring across finance, operations, workforce, inventory and security. Last scan: ${lastScan ? relativeTime(new Date(JSON.parse(lastScan.value) as string)) : "never"}.`}
        actions={
          <>
            <ExportCsvButton filename="merna-alerts.csv" />
            {writable && (
              <ActionButton
                label={<><RefreshCw size={13} /> Scan now</>}
                variant="secondary"
                size="md"
                action={runAlertScan}
              />
            )}
            {writable && (
              <ActionDialog
                trigger={<><Plus size={14} /> Raise alert</>}
                triggerVariant="primary"
                title="Raise a manual alert"
                action={createManualAlert}
                submitLabel="Raise alert"
              >
                <div>
                  <Label htmlFor="al-title" required>Title</Label>
                  <Input id="al-title" name="title" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="al-cat" required>Category</Label>
                    <Select id="al-cat" name="category" defaultValue="MANAGEMENT">
                      {ALERT_CATEGORIES.map((c) => <option key={c} value={c}>{ALERT_CATEGORY_LABELS[c]}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="al-sev" required>Severity</Label>
                    <Select id="al-sev" name="severity" defaultValue="WARNING">
                      {ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
                    </Select>
                  </div>
                </div>
                {!isBranchScoped(user.role) && (
                  <div>
                    <Label htmlFor="al-branch">Branch</Label>
                    <Select id="al-branch" name="branchId" defaultValue="">
                      <option value="">— Group-wide —</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="al-desc" required>Description</Label>
                  <Textarea id="al-desc" name="description" required />
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Open" value={fmtNumber(openCount)} tone={openCount > 0 ? "warning" : undefined} />
        <KpiCard label="Critical (unresolved)" value={fmtNumber(criticalCount)} tone={criticalCount > 0 ? "critical" : undefined} />
        <KpiCard label="Acknowledged" value={fmtNumber(ackCount)} />
        <KpiCard label="Resolved (7 days)" value={fmtNumber(resolved7d)} />
      </div>

      <Toolbar>
        <SearchInput placeholder="Search alerts…" className="w-full sm:w-56" />
        <FilterSelect param="category" label="Category" allLabel="All categories" options={ALERT_CATEGORIES.map((c) => ({ value: c, label: ALERT_CATEGORY_LABELS[c] }))} />
        <FilterSelect param="severity" label="Severity" allLabel="All severities" options={ALERT_SEVERITIES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        <FilterSelect param="status" label="Status" allLabel="Unresolved" options={[
          { value: "OPEN", label: "Open" },
          { value: "ACKNOWLEDGED", label: "Acknowledged" },
          { value: "RESOLVED", label: "Resolved" },
        ]} />
        {branches.length > 1 && (
          <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        )}
      </Toolbar>

      {alerts.length === 0 ? (
        <EmptyState
          icon={<Bell size={18} strokeWidth={1.5} />}
          title="No alerts match"
          description={sp.status === "RESOLVED" ? "No resolved alerts in this filter." : "Nothing needs attention right now. The engine rescans automatically as data changes."}
        />
      ) : (
        <div id="export-region" className="space-y-2.5">
          {alerts.map((a) => (
            <details key={a.id} className="group rounded-lg bg-canvas shadow-card open:shadow-raised">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2.5 px-4 py-3">
                <Badge tone={a.severity === "CRITICAL" ? "critical" : a.severity === "WARNING" ? "warning" : "ok"} dot>
                  {a.severity.toLowerCase()}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{a.title}</span>
                <Badge tone="neutral">{ALERT_CATEGORY_LABELS[a.category as keyof typeof ALERT_CATEGORY_LABELS] ?? a.category}</Badge>
                <Badge tone={statusTone(a.status)}>{a.status.toLowerCase()}</Badge>
                <span className="text-[11.5px] text-mute">{relativeTime(a.detectedAt)}</span>
              </summary>
              <div className="border-t border-hairline px-4 py-3">
                <p className="text-[13px] leading-relaxed text-body">{a.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-mute">
                  {a.branch && <span>Branch: <span className="text-body">{a.branch.name}</span></span>}
                  {a.department && <span>Department: <Link href={`/departments/${a.department.id}`} className="text-link hover:underline">{a.department.name}</Link></span>}
                  {a.metric && <span>Metric: <span className="font-mono text-body">{a.metric} = {a.value ?? "—"}</span> (threshold {a.threshold ?? "—"})</span>}
                  {a.ownerName && <span>Owner: <span className="text-body">{a.ownerName}</span></span>}
                  <span>Source: <span className="text-body">{a.source.toLowerCase()}</span></span>
                  <span>Detected: <span className="text-body">{fmtDateTime(a.detectedAt)}</span></span>
                </div>
                {a.notes && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-md bg-canvas-soft p-2.5 font-sans text-[12px] leading-relaxed text-body">{a.notes}</pre>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Link
                    href={`/merna-ai?prompt=${encodeURIComponent(`Explain this alert and what management should do: ${a.title}`)}`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[12.5px] font-medium text-violet-deep hover:border-violet hover:bg-ai-soft"
                  >
                    <Sparkles size={12} /> Ask Merna AI
                  </Link>
                  {writable && a.status === "OPEN" && (
                    <ActionButton label="Acknowledge" size="sm" action={alertAction} hidden={{ alertId: a.id, kind: "acknowledge" }} />
                  )}
                  {writable && a.status !== "RESOLVED" && (
                    <>
                      <ActionDialog
                        trigger="Assign"
                        triggerSize="sm"
                        title="Assign owner"
                        action={alertAction}
                        submitLabel="Assign"
                      >
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="kind" value="assign" />
                        <div>
                          <Label htmlFor={`ow-${a.id}`} required>Owner</Label>
                          <Input id={`ow-${a.id}`} name="owner" defaultValue={a.ownerName ?? user.name} required />
                        </div>
                      </ActionDialog>
                      <ActionButton
                        label="Add note"
                        size="sm"
                        variant="ghost"
                        action={alertAction}
                        confirmTitle="Add a note"
                        requireReason
                        reasonLabel="Note"
                        hidden={{ alertId: a.id, kind: "note" }}
                      />
                      <ActionButton
                        label="Resolve"
                        size="sm"
                        variant="primary"
                        action={alertAction}
                        confirmTitle="Resolve this alert?"
                        requireReason
                        reasonLabel="Resolution note"
                        hidden={{ alertId: a.id, kind: "resolve" }}
                      />
                    </>
                  )}
                  {writable && a.status === "RESOLVED" && (
                    <ActionButton
                      label="Reopen"
                      size="sm"
                      action={alertAction}
                      confirmTitle="Reopen this alert?"
                      requireReason
                      reasonLabel="Reason"
                      hidden={{ alertId: a.id, kind: "reopen" }}
                    />
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
