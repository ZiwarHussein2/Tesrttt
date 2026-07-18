import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { complianceStats } from "@/lib/analytics/metrics";
import { fmtDateTime, fmtNumber, fmtPercent, maskName } from "@/lib/format";
import { maskingFor } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Select } from "@/components/ui/input";

export const metadata: Metadata = { title: "Legal Accountability" };

type Search = { q?: string; risk?: string; branch?: string };

export default async function LegalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("legal");
  const scope = await getScope(user);
  const sp = await searchParams;
  const masking = maskingFor(user.role);

  const [comp, agreements, pendingAttendance, retentionEvents, employees, evidenceEvents, hashedCount] = await Promise.all([
    complianceStats(scope.branchIds),
    db.agreement.findMany({
      where: { branchId: { in: scope.branchIds } },
      select: { status: true, pdfHash: true },
    }),
    db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, reviewStatus: "PENDING" } }),
    db.auditEvent.count(),
    db.employee.findMany({
      where: { branchId: { in: scope.branchIds }, employmentStatus: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, branch: { select: { name: true } } },
      orderBy: { firstName: "asc" },
    }),
    db.auditEvent.findMany({
      where: {
        OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }],
        ...(sp.branch ? { branchId: sp.branch } : {}),
        ...(sp.risk ? { riskLevel: sp.risk } : {}),
        action: {
          in: [
            "agreement.issue", "agreement.accept", "agreement.terminate",
            "policy.publish", "policy.acceptance",
            "attendance.correct", "attendance.review-exception",
            "employee.update-compensation", "employee.create",
            "discount.approve", "discount.reject",
            "system.setup", "auth.login",
          ],
        },
        ...(sp.q
          ? {
              AND: [{ OR: [{ resourceLabel: { contains: sp.q } }, { userName: { contains: sp.q } }, { action: { contains: sp.q } }] }],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.agreement.count({ where: { branchId: { in: scope.branchIds }, pdfHash: { not: null } } }),
  ]);

  const acceptedAgreements = agreements.filter((a) => a.status === "ACCEPTED").length;
  const branches = await db.branch.findMany({
    where: { id: { in: scope.branchIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Legal Accountability Center"
        subtitle="Formal evidence command center: agreements, acceptances, corrections, approvals and audit integrity in one place."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Agreement completion" value={comp.agreementRate !== null ? fmtPercent(comp.agreementRate) : "—"} tone={comp.agreementRate !== null && comp.agreementRate < 100 ? "warning" : undefined} definition="Active employees with an accepted agreement." />
        <KpiCard label="Policy acceptance" value={comp.policyAcceptanceRate !== null ? fmtPercent(comp.policyAcceptanceRate) : "—"} />
        <KpiCard label="Accepted agreements" value={fmtNumber(acceptedAgreements)} />
        <KpiCard label="Hashed documents" value={fmtNumber(hashedCount)} definition="Agreements sealed with a SHA-256 content hash at acceptance." />
        <KpiCard label="Open legal exceptions" value={fmtNumber(pendingAttendance + comp.pendingDiscounts)} tone={pendingAttendance + comp.pendingDiscounts > 0 ? "warning" : undefined} definition="Pending attendance reviews and undecided discount requests." />
        <KpiCard label="Audit events retained" value={fmtNumber(retentionEvents)} definition="Append-only, no deletion path. Retention: indefinite in this deployment." />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Evidence timeline" subtitle="Legally relevant events — filter by person, branch or risk" />
          <CardBody className="pb-0">
            <Toolbar className="mb-0">
              <SearchInput placeholder="Filter by person, action…" className="w-full sm:w-64" />
              <FilterSelect param="risk" label="Risk" allLabel="All risk levels" options={[
                { value: "HIGH", label: "High" }, { value: "MEDIUM", label: "Medium" }, { value: "LOW", label: "Low" },
              ]} />
              {branches.length > 1 && (
                <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              )}
            </Toolbar>
          </CardBody>
          <TableShell className="rounded-t-none shadow-none" dense>
            <THead>
              <Th>Time</Th><Th>Event</Th><Th>Subject</Th><Th>By</Th><Th>Risk</Th><Th align="right">Audit</Th>
            </THead>
            <tbody>
              {evidenceEvents.length === 0 && <TableEmpty colSpan={6}>No evidence events match.</TableEmpty>}
              {evidenceEvents.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap text-mute">{fmtDateTime(e.createdAt)}</Td>
                  <Td mono>{e.action}</Td>
                  <Td className="max-w-52"><span className="block truncate">{e.resourceLabel ?? e.resourceType}</span></Td>
                  <Td>{e.userName}</Td>
                  <Td><Badge tone={e.riskLevel === "HIGH" ? "critical" : e.riskLevel === "MEDIUM" ? "warning" : "neutral"}>{e.riskLevel.toLowerCase()}</Badge></Td>
                  <Td align="right">
                    <Link href={`/audit?event=${e.id}`} className="text-[12px] font-medium text-link hover:underline">Open</Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card>
          <CardHeader
            title="Generate evidence package"
            subtitle="Formal per-employee dossier: agreements, acceptance evidence, attendance exceptions, management actions"
          />
          <CardBody>
            {employees.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-mute">No active employees in scope.</p>
            ) : (
              <form action="/governance/legal/evidence" method="GET" className="space-y-3">
                <div>
                  <label htmlFor="ev-emp" className="mb-1.5 block text-[13px] font-medium text-ink">Subject employee</label>
                  <Select id="ev-emp" name="employeeId" required>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {masking.employeeContact ? maskName(e.firstName, e.lastName) : `${e.firstName} ${e.lastName}`} · {e.branch.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <button
                  type="submit"
                  className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-[13px] font-medium text-on-primary hover:bg-black"
                >
                  <Scale size={14} className="mr-2" />
                  Build evidence package
                </button>
                <p className="text-[11.5px] leading-relaxed text-mute">
                  Opens a formal, print-ready dossier with a generation timestamp and confidentiality footer.
                  Use the browser print dialog to save it as PDF.
                </p>
              </form>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Accountability posture" subtitle="Where the organization stands on evidence discipline" />
        <CardBody className="grid grid-cols-1 gap-3 text-[12.5px] leading-relaxed text-body sm:grid-cols-2 lg:grid-cols-4">
          <PostureItem ok={comp.agreementRate === 100} label="Employee agreements" detail={comp.agreementRate !== null ? `${comp.agreementRate.toFixed(0)}% of active employees have an accepted agreement.` : "No active employees yet."} />
          <PostureItem ok={(comp.policyAcceptanceRate ?? 0) >= 90 || comp.activePolicies === 0} label="Policy acceptance" detail={comp.activePolicies === 0 ? "No active policies published yet." : `${(comp.policyAcceptanceRate ?? 0).toFixed(0)}% of policy acceptances collected.`} />
          <PostureItem ok={pendingAttendance === 0} label="Attendance evidence" detail={pendingAttendance === 0 ? "No attendance exceptions awaiting review." : `${pendingAttendance} exception(s) awaiting review.`} />
          <PostureItem ok={comp.pendingDiscounts === 0} label="Management approvals" detail={comp.pendingDiscounts === 0 ? "No undecided discount requests." : `${comp.pendingDiscounts} discount request(s) pending decision.`} />
        </CardBody>
      </Card>
    </>
  );
}

function PostureItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="rounded-md border border-hairline p-3">
      <p className="mb-1 flex items-center gap-2 text-[13px] font-medium text-ink">
        <Badge tone={ok ? "good" : "warning"} dot>{ok ? "OK" : "Attention"}</Badge>
        {label}
      </p>
      <p className="text-mute">{detail}</p>
    </div>
  );
}
