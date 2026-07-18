import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCheck, FilePlus2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canWrite, maskingFor } from "@/lib/permissions";
import { fmtDate, fmtDateTime, fmtNumber, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ActionButton, ActionDialog } from "@/components/ui/dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { Label, Textarea } from "@/components/ui/input";
import { PrintButton } from "@/components/ui/export-button";
import { POLICY_CATEGORY_LABELS } from "@/types/enums";
import { newPolicyVersion, publishPolicy } from "../actions";

export const metadata: Metadata = { title: "Policy" };

export default async function PolicyPage({ params }: { params: Promise<{ policyId: string }> }) {
  const user = await requireUser("policies");
  const { policyId } = await params;
  const masking = maskingFor(user.role);

  const policy = await db.policy.findUnique({
    where: { id: policyId },
    include: {
      acceptances: {
        include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, branch: { select: { name: true } } } } },
        orderBy: { acceptedAt: "desc" },
      },
    },
  });
  if (!policy) notFound();

  const pendingEmployees = policy.status === "ACTIVE"
    ? await db.employee.findMany({
        where: {
          employmentStatus: "ACTIVE",
          policyAcceptances: { none: { policyId } },
        },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, branch: { select: { name: true } } },
        orderBy: { firstName: "asc" },
        take: 50,
      })
    : [];

  const writable = canWrite(user.role, "policies");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Policies", href: "/policies" }, { label: policy.title }]}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {policy.title}
            <Badge tone={statusTone(policy.status)} dot>{policy.status.toLowerCase()}</Badge>
            <span className="font-mono text-sm text-mute">v{policy.version}</span>
          </span>
        }
        subtitle={`${POLICY_CATEGORY_LABELS[policy.category as keyof typeof POLICY_CATEGORY_LABELS] ?? policy.category}${policy.effectiveDate ? ` · Effective ${fmtDate(policy.effectiveDate)}` : ""}`}
        actions={
          <>
            <PrintButton label="Export PDF" />
            {writable && policy.status === "DRAFT" && (
              <ActionButton
                label={<><CheckCheck size={13} /> Publish</>}
                variant="primary"
                size="md"
                action={publishPolicy}
                confirmTitle={`Publish ${policy.title} v${policy.version}?`}
                confirmDescription="The policy becomes active immediately and any previous active version is superseded. Employees must accept the new version."
                hidden={{ policyId: policy.id }}
              />
            )}
            {writable && policy.status === "ACTIVE" && (
              <ActionDialog
                trigger={<><FilePlus2 size={13} /> New version</>}
                title={`New version of ${policy.title}`}
                description={`Creates draft v${policy.version + 1}. Publishing it will supersede v${policy.version} and reset acceptance.`}
                action={newPolicyVersion}
                submitLabel="Create draft"
                wide
              >
                <input type="hidden" name="policyId" value={policy.id} />
                <div>
                  <Label htmlFor="nv-body" required>Updated policy text</Label>
                  <Textarea id="nv-body" name="body" defaultValue={policy.body} required className="min-h-[200px]" />
                </div>
                <div>
                  <Label htmlFor="nv-reason">Reason for revision</Label>
                  <Textarea id="nv-reason" name="reason" placeholder="Recorded in the audit log" />
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Policy text" subtitle="Version-locked content" />
          <CardBody>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-body">{policy.body}</p>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: "Version", value: <span className="font-mono">v{policy.version}</span> },
                  { label: "Author", value: policy.authorName ?? "—" },
                  { label: "Approver", value: policy.approverName ?? "—" },
                  { label: "Created", value: fmtDateTime(policy.createdAt) },
                  { label: "Effective", value: policy.effectiveDate ? fmtDateTime(policy.effectiveDate) : "—" },
                  { label: "Acceptances", value: fmtNumber(policy.acceptances.length) },
                ]}
              />
            </CardBody>
          </Card>

          {policy.status === "ACTIVE" && (
            <Card>
              <CardHeader title="Pending employees" subtitle={`${pendingEmployees.length} still to accept`} />
              <CardBody>
                {pendingEmployees.length === 0 ? (
                  <p className="text-center text-[13px] text-good-deep">All active employees have accepted this version.</p>
                ) : (
                  <ul className="max-h-64 space-y-1.5 overflow-y-auto thin-scroll">
                    {pendingEmployees.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <Link href={`/employees/${e.id}?tab=policies`} className="text-body hover:text-ink hover:underline">
                          {masking.employeeContact ? maskName(e.firstName, e.lastName) : `${e.firstName} ${e.lastName}`}
                        </Link>
                        <span className="text-[11px] text-mute">{e.branch.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Acceptance record" subtitle="Who accepted this version, when, and with what evidence" />
        <TableShell className="rounded-t-none shadow-none">
          <THead>
            <Th>Employee</Th><Th>Branch</Th><Th align="right">Accepted</Th><Th>OTP</Th><Th>Device</Th>
          </THead>
          <tbody>
            {policy.acceptances.length === 0 && <TableEmpty colSpan={5}>No acceptances recorded for this version.</TableEmpty>}
            {policy.acceptances.map((a) => (
              <Tr key={a.id}>
                <Td>
                  <Link href={`/employees/${a.employee.id}`} className="font-medium text-ink hover:underline">
                    {masking.employeeContact ? maskName(a.employee.firstName, a.employee.lastName) : `${a.employee.firstName} ${a.employee.lastName}`}
                  </Link>
                  <span className="block font-mono text-[10.5px] text-mute">{a.employee.employeeCode}</span>
                </Td>
                <Td>{a.employee.branch.name}</Td>
                <Td align="right">{fmtDateTime(a.acceptedAt)}</Td>
                <Td>{a.otpVerified ? <Badge tone="good">Verified</Badge> : <Badge tone="neutral">No</Badge>}</Td>
                <Td>{a.deviceRecorded ? <Badge tone="good">Recorded</Badge> : <Badge tone="neutral">No</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </>
  );
}
