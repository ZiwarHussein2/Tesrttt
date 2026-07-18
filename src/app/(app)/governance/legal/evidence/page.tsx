import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isBranchScoped } from "@/lib/permissions";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, statusTone } from "@/components/ui/badge";
import { PrintButton } from "@/components/ui/export-button";
import { AGREEMENT_STATUS_LABELS, ATTENDANCE_STATUS_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Evidence Package" };

export default async function EvidencePackagePage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string }>;
}) {
  const user = await requireUser("legal");
  const { employeeId } = await searchParams;
  if (!employeeId) notFound();

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      branch: { select: { id: true, name: true } },
      department: { select: { name: true } },
      company: { select: { name: true, legalName: true } },
      agreements: { orderBy: [{ title: "asc" }, { version: "desc" }] },
      policyAcceptances: { include: { policy: { select: { title: true, version: true, category: true } } }, orderBy: { acceptedAt: "desc" } },
      attendanceRecords: {
        where: { OR: [{ exception: true }, { correctionReason: { not: null } }] },
        orderBy: { date: "desc" },
        take: 30,
      },
    },
  });
  if (!employee) notFound();
  if (isBranchScoped(user.role) && user.branchId !== employee.branchId) notFound();

  const auditEvents = await db.auditEvent.findMany({
    where: {
      OR: [
        { resourceType: "Employee", resourceId: employee.id },
        { resourceLabel: { contains: `${employee.firstName} ${employee.lastName}` } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const generatedAt = new Date();

  // Building an evidence package is itself an audited access event.
  const sessionUser = await getSessionUser();
  await logAudit(sessionUser, {
    action: "legal.evidence-package",
    resourceType: "Employee",
    resourceId: employee.id,
    resourceLabel: `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
    branchId: employee.branchId,
    reason: "Evidence package generated",
    riskLevel: "HIGH",
  });

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="print:hidden">
        <PageHeader
          breadcrumbs={[
            { label: "Legal Accountability", href: "/governance/legal" },
            { label: "Evidence package" },
          ]}
          title="Evidence Package"
          subtitle="Print-ready formal dossier. Use Print / PDF to export — the export itself is recorded in the audit log."
          actions={<PrintButton label="Print / Save PDF" />}
        />
      </div>

      <div className="rounded-lg bg-canvas p-8 shadow-card print:rounded-none print:p-0 print:shadow-none">
        {/* Formal header */}
        <div className="border-b-2 border-primary pb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Confidential — Legal Evidence</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.8px] text-ink">
            Employee Evidence Package
          </h1>
          <p className="mt-1 text-[13px] text-body">
            {employee.company.legalName ?? employee.company.name} · Prepared by Merna Control Center
          </p>
        </div>

        {/* Subject */}
        <Section title="1. Subject">
          <Grid rows={[
            ["Employee", `${employee.firstName} ${employee.lastName}`],
            ["Employee code", employee.employeeCode],
            ["Job title", employee.jobTitle],
            ["Branch", employee.branch.name],
            ["Department", employee.department?.name ?? "—"],
            ["Employment status", employee.employmentStatus.replace(/_/g, " ").toLowerCase()],
            ["Start date", fmtDate(employee.startDate)],
            ["Work schedule", `${employee.workScheduleStart} – ${employee.workScheduleEnd}`],
          ]} />
        </Section>

        {/* Agreements */}
        <Section title="2. Agreement versions & acceptance evidence">
          {employee.agreements.length === 0 ? (
            <p className="text-[13px] text-mute">No agreements on record.</p>
          ) : (
            <div className="space-y-3">
              {employee.agreements.map((a) => (
                <div key={a.id} className="rounded-md border border-hairline p-3 print:break-inside-avoid">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                    {a.title} <span className="font-mono text-[11px] text-mute">v{a.version}</span>
                    <Badge tone={statusTone(a.status)}>{AGREEMENT_STATUS_LABELS[a.status as keyof typeof AGREEMENT_STATUS_LABELS]}</Badge>
                  </p>
                  <Grid rows={[
                    ["Issued", fmtDateTime(a.issuedAt)],
                    ["Accepted", fmtDateTime(a.acceptedAt)],
                    ["OTP verified", a.otpVerified ? "Yes" : "No"],
                    ["Device recorded", a.deviceRecorded ? "Yes" : "No"],
                    ["Network recorded", a.networkRecorded ? "Yes" : "No"],
                    ["Location recorded", a.locationRecorded ? "Yes" : "No"],
                    ["Document hash (SHA-256)", a.pdfHash ?? "—"],
                  ]} />
                  {a.acceptanceStatement && (
                    <p className="mt-2 rounded bg-canvas-soft p-2 text-[12px] italic text-body">&ldquo;{a.acceptanceStatement}&rdquo;</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Policies */}
        <Section title="3. Policy acceptances">
          {employee.policyAcceptances.length === 0 ? (
            <p className="text-[13px] text-mute">No policy acceptances on record.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-wider text-mute">
                  <th className="py-1.5 pr-3">Policy</th><th className="py-1.5 pr-3">Version</th>
                  <th className="py-1.5 pr-3">Accepted</th><th className="py-1.5 pr-3">OTP</th><th className="py-1.5">Device</th>
                </tr>
              </thead>
              <tbody>
                {employee.policyAcceptances.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0">
                    <td className="py-1.5 pr-3 text-ink">{p.policy.title}</td>
                    <td className="py-1.5 pr-3 font-mono">v{p.policy.version}</td>
                    <td className="py-1.5 pr-3">{fmtDateTime(p.acceptedAt)}</td>
                    <td className="py-1.5 pr-3">{p.otpVerified ? "Yes" : "No"}</td>
                    <td className="py-1.5">{p.deviceRecorded ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Attendance exceptions */}
        <Section title="4. Attendance exceptions & corrections">
          {employee.attendanceRecords.length === 0 ? (
            <p className="text-[13px] text-mute">No exceptions or corrections on record.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-wider text-mute">
                  <th className="py-1.5 pr-3">Date</th><th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5 pr-3">In / Out</th><th className="py-1.5 pr-3">Exception</th><th className="py-1.5">Correction reason</th>
                </tr>
              </thead>
              <tbody>
                {employee.attendanceRecords.map((r) => (
                  <tr key={r.id} className="border-b border-hairline last:border-0">
                    <td className="py-1.5 pr-3">{fmtDate(r.date)}</td>
                    <td className="py-1.5 pr-3">{ATTENDANCE_STATUS_LABELS[r.status as keyof typeof ATTENDANCE_STATUS_LABELS]}</td>
                    <td className="py-1.5 pr-3">{fmtTime(r.checkIn)} / {fmtTime(r.checkOut)}</td>
                    <td className="py-1.5 pr-3">{r.exceptionType?.replace(/_/g, " ").toLowerCase() ?? "—"}</td>
                    <td className="py-1.5">{r.correctionReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Audit references */}
        <Section title="5. Management actions & audit references">
          {auditEvents.length === 0 ? (
            <p className="text-[13px] text-mute">No audit events reference this employee.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-wider text-mute">
                  <th className="py-1.5 pr-3">Time</th><th className="py-1.5 pr-3">Action</th>
                  <th className="py-1.5 pr-3">By</th><th className="py-1.5 pr-3">Risk</th><th className="py-1.5">Audit ID</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((e) => (
                  <tr key={e.id} className="border-b border-hairline last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
                    <td className="py-1.5 pr-3 font-mono">{e.action}</td>
                    <td className="py-1.5 pr-3">{e.userName}</td>
                    <td className="py-1.5 pr-3">{e.riskLevel.toLowerCase()}</td>
                    <td className="py-1.5 font-mono text-[10px]">{e.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Footer */}
        <div className="mt-8 border-t-2 border-primary pt-3 text-[11px] leading-relaxed text-mute">
          <p>
            Generated {fmtDateTime(generatedAt)} by {user.name} via Merna Control Center.
            This package was assembled from the append-only audit trail and versioned records of{" "}
            {employee.company.legalName ?? employee.company.name}.
          </p>
          <p className="mt-1 font-medium">
            Confidential — prepared for authorized legal and compliance use only.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 print:break-inside-avoid-page">
      <h2 className="mb-2.5 text-[14px] font-semibold tracking-[-0.3px] text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2 text-[12.5px]">
          <dt className="w-40 shrink-0 text-mute">{label}</dt>
          <dd className="break-all text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
