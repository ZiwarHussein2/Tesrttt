import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { DescriptionList } from "@/components/ui/description-list";
import { ActionButton, ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PrintButton } from "@/components/ui/export-button";
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS } from "@/types/enums";
import { addIncidentNote, advanceIncident } from "../actions";

export const metadata: Metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const user = await requireUser("incidents");
  const { incidentId } = await params;

  const incident = await db.incident.findUnique({
    where: { id: incidentId },
    include: {
      branch: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!incident) notFound();
  if (isBranchScoped(user.role) && incident.branchId && incident.branchId !== user.branchId) notFound();

  const writable = canWrite(user.role, "incidents");
  const currentIdx = INCIDENT_STATUSES.indexOf(incident.status as (typeof INCIDENT_STATUSES)[number]);
  const nextStatus = currentIdx >= 0 && currentIdx < INCIDENT_STATUSES.length - 1 ? INCIDENT_STATUSES[currentIdx + 1] : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Incidents", href: "/incidents" }, { label: incident.title }]}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {incident.title}
            <Badge tone={statusTone(incident.status)} dot>
              {INCIDENT_STATUS_LABELS[incident.status as keyof typeof INCIDENT_STATUS_LABELS]}
            </Badge>
          </span>
        }
        subtitle={`${INCIDENT_TYPE_LABELS[incident.type as keyof typeof INCIDENT_TYPE_LABELS] ?? incident.type} · ${incident.severity.toLowerCase()} severity · ${incident.branch?.name ?? "Group-wide"}`}
        actions={
          <>
            <PrintButton label="Export report" />
            {writable && incident.status !== "CLOSED" && nextStatus && (
              <ActionDialog
                trigger={`Advance → ${INCIDENT_STATUS_LABELS[nextStatus]}`}
                triggerVariant="primary"
                title={`Advance to ${INCIDENT_STATUS_LABELS[nextStatus]}`}
                description="Each step requires a note; root cause is mandatory before closing."
                action={advanceIncident}
                submitLabel="Advance"
              >
                <input type="hidden" name="incidentId" value={incident.id} />
                <input type="hidden" name="status" value={nextStatus} />
                <div>
                  <Label htmlFor="adv-note" required>Step note</Label>
                  <Textarea id="adv-note" name="reason" required />
                </div>
                <div>
                  <Label htmlFor="adv-owner">Owner</Label>
                  <Input id="adv-owner" name="owner" defaultValue={incident.ownerName ?? user.name} />
                </div>
                {(nextStatus === "RESOLVED" || nextStatus === "REVIEWED" || nextStatus === "CLOSED") && (
                  <>
                    <div>
                      <Label htmlFor="adv-root" required={nextStatus === "CLOSED" && !incident.rootCause}>Root cause</Label>
                      <Textarea id="adv-root" name="rootCause" defaultValue={incident.rootCause ?? ""} />
                    </div>
                    <div>
                      <Label htmlFor="adv-corr">Corrective action</Label>
                      <Textarea id="adv-corr" name="correctiveAction" defaultValue={incident.correctiveAction ?? ""} />
                    </div>
                  </>
                )}
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Timeline" subtitle="Chronological, append-only record" />
          <CardBody>
            <ol className="relative ml-2 space-y-4 border-l border-hairline pl-5">
              {incident.events.map((e) => (
                <li key={e.id} className="relative">
                  <span aria-hidden className="absolute -left-[25.5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-hairline-strong" />
                  <p className="text-[13px] leading-relaxed text-body">{e.note}</p>
                  <p className="mt-0.5 text-[11.5px] text-mute">{e.byName} · {fmtDateTime(e.createdAt)}</p>
                </li>
              ))}
            </ol>
            {writable && (
              <div className="mt-4 border-t border-hairline pt-4">
                <ActionButton
                  label="Add timeline note"
                  action={addIncidentNote}
                  confirmTitle="Add timeline note"
                  requireReason
                  reasonLabel="Note"
                  hidden={{ incidentId: incident.id }}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: "Description", value: <span className="whitespace-pre-wrap text-[13px]">{incident.description}</span> },
                { label: "Impact", value: incident.impact ?? "—" },
                { label: "Owner", value: incident.ownerName ?? "—" },
                { label: "Detected", value: fmtDateTime(incident.detectedAt) },
                { label: "Closed", value: incident.closedAt ? fmtDateTime(incident.closedAt) : "—" },
                { label: "Root cause", value: incident.rootCause ?? "—" },
                { label: "Corrective action", value: incident.correctiveAction ?? "—" },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
