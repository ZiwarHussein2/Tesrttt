import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { DATA_CLASSIFICATIONS, DATA_CLASSIFICATION_LABELS, ROLES, ROLE_LABELS, type Role } from "@/types/enums";
import { maskingFor } from "@/lib/permissions";

export const metadata: Metadata = { title: "Privacy Center" };

const CLASSIFICATION_EXAMPLES: Record<string, string> = {
  PUBLIC: "Branch names, published service list",
  INTERNAL: "Department schedules, queue statistics",
  CONFIDENTIAL: "Expense records, budgets, referral deals",
  HIGHLY_CONFIDENTIAL: "Agreement terms, evidence packages, audit detail",
  MEDICAL_SENSITIVE: "Visit reports, scan results, report text",
  HR_SENSITIVE: "Salaries, attendance corrections, personal contacts",
  FINANCIAL_SENSITIVE: "Payroll runs, doctor liabilities, income detail",
  SECURITY_SENSITIVE: "Sessions, failed logins, security incidents",
};

export default async function PrivacyPage() {
  const user = await requireUser("privacy");
  const scope = await getScope(user);

  const [patients, consentWithdrawn, patientAccess7d, privacyIncidents, exportEvents30d, noticeVersions] = await Promise.all([
    db.patient.count(),
    db.patient.count({ where: { consentStatus: "WITHDRAWN" } }),
    db.auditEvent.count({
      where: { resourceType: { in: ["Patient", "Visit"] }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    }),
    db.incident.count({ where: { type: "PRIVACY", status: { notIn: ["CLOSED"] } } }),
    db.auditEvent.count({
      where: { action: { in: ["legal.evidence-package", "alerts.scan"] }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    }),
    db.patient.groupBy({ by: ["privacyNoticeVersion"], _count: { id: true } }),
  ]);

  const accessLog = await db.auditEvent.findMany({
    where: {
      OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
      resourceType: { in: ["Patient", "Visit", "Employee", "Agreement"] },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  // Masking matrix per role (live from the permission engine)
  const maskRows = ROLES.map((r) => ({ role: r, m: maskingFor(r as Role) }));

  return (
    <>
      <PageHeader
        title="Privacy Center"
        subtitle="Data classification, minimum-necessary access, masking, consent and access history — enforced by the permission engine, not just the UI."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Patient records" value={fmtNumber(patients)} />
        <KpiCard label="Consent withdrawn" value={fmtNumber(consentWithdrawn)} tone={consentWithdrawn > 0 ? "warning" : undefined} />
        <KpiCard label="Data-access events (7d)" value={fmtNumber(patientAccess7d)} definition="Audited reads/changes touching patient or visit records." />
        <KpiCard label="Open privacy incidents" value={fmtNumber(privacyIncidents)} tone={privacyIncidents > 0 ? "critical" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Data classification" subtitle="Every record class has a handling level" />
          <TableShell className="rounded-t-none shadow-none" dense>
            <THead>
              <Th>Classification</Th><Th>Examples</Th>
            </THead>
            <tbody>
              {DATA_CLASSIFICATIONS.map((c) => (
                <Tr key={c}>
                  <Td>
                    <Badge tone={c === "PUBLIC" ? "good" : c === "INTERNAL" ? "ok" : c.includes("SENSITIVE") ? "critical" : "warning"}>
                      {DATA_CLASSIFICATION_LABELS[c]}
                    </Badge>
                  </Td>
                  <Td className="text-[12px] text-body">{CLASSIFICATION_EXAMPLES[c]}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card>
          <CardHeader title="Masking matrix" subtitle="What each role cannot see (live from the permission engine)" />
          <TableShell className="rounded-t-none shadow-none" dense>
            <THead>
              <Th>Role</Th><Th align="center">Patient contact</Th><Th align="center">Employee contact</Th>
              <Th align="center">Salaries</Th><Th align="center">Finance detail</Th><Th align="center">Legal evidence</Th>
            </THead>
            <tbody>
              {maskRows.map(({ role, m }) => (
                <Tr key={role}>
                  <Td className="text-[12px] font-medium text-ink">{ROLE_LABELS[role as Role]}</Td>
                  <MaskCell masked={m.patientContact} />
                  <MaskCell masked={m.employeeContact} />
                  <MaskCell masked={m.employeeSalary} />
                  <MaskCell masked={m.financeDetail} />
                  <MaskCell masked={m.legalEvidence} />
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card>
          <CardHeader title="Consent & notices" subtitle="Recorded per patient at registration" />
          <CardBody>
            <ul className="space-y-2 text-[13px]">
              {noticeVersions.length === 0 && <li className="text-mute">No patients registered yet.</li>}
              {noticeVersions.map((v) => (
                <li key={v.privacyNoticeVersion ?? "none"} className="flex items-center justify-between border-t border-hairline pt-2 first:border-0 first:pt-0">
                  <span className="text-body">Privacy notice {v.privacyNoticeVersion ?? "unrecorded"}</span>
                  <span className="font-medium tabular-nums text-ink">{v._count.id} patients</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1.5 border-t border-hairline pt-3 text-[12.5px] leading-relaxed text-body">
              <Principle text="Minimum-necessary access — roles see only what their function requires." />
              <Principle text="Public QR codes never contain patient data — only opaque verification tokens." />
              <Principle text="Merna AI answers respect the same masking rules and never expose restricted values." />
              <Principle text="Exports and evidence packages are themselves audit-logged (controlled export)." />
              <Principle text="Monitoring notices: location/device checks show status classes only — never coordinates." />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent data access"
            subtitle={`${fmtNumber(exportEvents30d)} controlled exports in 30 days`}
            actions={<Link href="/audit" className="text-[12px] font-medium text-link hover:underline">Full audit log</Link>}
          />
          <TableShell className="rounded-t-none shadow-none" dense>
            <THead>
              <Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Record</Th>
            </THead>
            <tbody>
              {accessLog.length === 0 && <TableEmpty colSpan={4}>No access events yet.</TableEmpty>}
              {accessLog.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap text-mute">{fmtDateTime(e.createdAt)}</Td>
                  <Td>{e.userName}</Td>
                  <Td mono>{e.action}</Td>
                  <Td className="max-w-48"><span className="block truncate">{e.resourceLabel ?? e.resourceType}</span></Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      </div>
    </>
  );
}

function MaskCell({ masked }: { masked: boolean }) {
  return (
    <Td align="center">
      {masked ? <Badge tone="critical">Masked</Badge> : <Badge tone="good">Visible</Badge>}
    </Td>
  );
}

function Principle({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2">
      <ShieldCheck size={13} className="mt-0.5 shrink-0 text-good-deep" />
      {text}
    </p>
  );
}
