import type { Metadata } from "next";
import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, INCIDENT_TYPES, INCIDENT_TYPE_LABELS,
} from "@/types/enums";
import { createIncident } from "./actions";

export const metadata: Metadata = { title: "Incidents" };

type Search = { q?: string; type?: string; status?: string; severity?: string };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("incidents");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "incidents");

  const where = {
    OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.severity ? { severity: sp.severity } : {}),
    ...(sp.q ? { title: { contains: sp.q } } : {}),
  };

  const [incidents, branches, openCount, highCount, closed30d] = await Promise.all([
    db.incident.findMany({
      where,
      include: { branch: { select: { name: true } }, _count: { select: { events: true } } },
      orderBy: [{ detectedAt: "desc" }],
      take: 60,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.incident.count({ where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: { notIn: ["CLOSED", "RESOLVED", "REVIEWED"] } } }),
    db.incident.count({ where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: { notIn: ["CLOSED"] }, severity: { in: ["HIGH", "CRITICAL"] } } }),
    db.incident.count({ where: { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }], status: "CLOSED", closedAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
  ]);

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Open incident</>}
      triggerVariant="primary"
      title="Open an incident"
      description="Incidents move through a fixed workflow: detected → triaged → assigned → investigating → contained → resolved → reviewed → closed."
      action={createIncident}
      submitLabel="Open incident"
      wide
    >
      <div>
        <Label htmlFor="ic-title" required>Title</Label>
        <Input id="ic-title" name="title" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ic-type" required>Type</Label>
          <Select id="ic-type" name="type" defaultValue="OPERATIONAL">
            {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="ic-sev" required>Severity</Label>
          <Select id="ic-sev" name="severity" defaultValue="MEDIUM">
            {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </Select>
        </div>
      </div>
      {!isBranchScoped(user.role) && (
        <div>
          <Label htmlFor="ic-branch">Branch</Label>
          <Select id="ic-branch" name="branchId" defaultValue="">
            <option value="">— Group-wide —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      )}
      <div>
        <Label htmlFor="ic-desc" required>What happened</Label>
        <Textarea id="ic-desc" name="description" required />
      </div>
      <div>
        <Label htmlFor="ic-impact">Impact</Label>
        <Input id="ic-impact" name="impact" placeholder="Affected systems, data, patients or finances" />
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Security, privacy, operational, financial and equipment incidents with a full timeline and closure discipline."
        actions={<>
          <ExportCsvButton filename="merna-incidents.csv" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Open incidents" value={fmtNumber(openCount)} tone={openCount > 0 ? "warning" : undefined} />
        <KpiCard label="High / critical" value={fmtNumber(highCount)} tone={highCount > 0 ? "critical" : undefined} />
        <KpiCard label="Closed (30 days)" value={fmtNumber(closed30d)} />
        <KpiCard label="On record" value={fmtNumber(incidents.length)} />
      </div>

      <Toolbar>
        <SearchInput placeholder="Search incidents…" className="w-full sm:w-56" />
        <FilterSelect param="type" label="Type" allLabel="All types" options={INCIDENT_TYPES.map((t) => ({ value: t, label: INCIDENT_TYPE_LABELS[t] }))} />
        <FilterSelect param="status" label="Status" allLabel="All statuses" options={INCIDENT_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] }))} />
        <FilterSelect param="severity" label="Severity" allLabel="All severities" options={INCIDENT_SEVERITIES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
      </Toolbar>

      {incidents.length === 0 ? (
        <EmptyState
          icon={<TriangleAlert size={18} strokeWidth={1.5} />}
          title="No incidents"
          description="Open an incident when something needs a formal investigation trail — security events, equipment failures, data-quality problems."
          action={addDialog}
        />
      ) : (
        <div id="export-region">
          <TableShell>
            <THead>
              <Th>Incident</Th><Th>Type</Th><Th>Severity</Th><Th>Branch</Th><Th>Status</Th>
              <Th>Owner</Th><Th align="right">Timeline</Th><Th align="right">Detected</Th>
            </THead>
            <tbody>
              {incidents.map((i) => (
                <Tr key={i.id} highlight={["HIGH", "CRITICAL"].includes(i.severity) && i.status !== "CLOSED"}>
                  <Td className="max-w-64">
                    <Link href={`/incidents/${i.id}`} className="block truncate font-medium text-ink hover:underline">{i.title}</Link>
                  </Td>
                  <Td>{INCIDENT_TYPE_LABELS[i.type as keyof typeof INCIDENT_TYPE_LABELS] ?? i.type}</Td>
                  <Td>
                    <Badge tone={i.severity === "CRITICAL" || i.severity === "HIGH" ? "critical" : i.severity === "MEDIUM" ? "warning" : "neutral"} dot>
                      {i.severity.toLowerCase()}
                    </Badge>
                  </Td>
                  <Td>{i.branch?.name ?? "Group"}</Td>
                  <Td><Badge tone={statusTone(i.status)}>{INCIDENT_STATUS_LABELS[i.status as keyof typeof INCIDENT_STATUS_LABELS]}</Badge></Td>
                  <Td className="text-mute">{i.ownerName ?? "—"}</Td>
                  <Td align="right">{i._count.events}</Td>
                  <Td align="right" className="text-mute">{fmtDateTime(i.detectedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}
    </>
  );
}
