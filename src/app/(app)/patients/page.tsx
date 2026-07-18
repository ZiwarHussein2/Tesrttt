import type { Metadata } from "next";
import { HeartPulse, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { visitStats } from "@/lib/analytics/metrics";
import { ageRange, fmtDate, fmtDuration, fmtNumber, fmtPercent, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { HBarList } from "@/components/ui/viz";
import { DEPARTMENT_TYPE_LABELS, VISIT_STATUS_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Patients" };

const PAGE_SIZE = 25;

type Search = { q?: string; branch?: string; status?: string; page?: string };

export default async function PatientsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("patients");
  const scope = await getScope(user);
  const sp = await searchParams;

  const stats = await visitStats(scope.branchIds, scope);

  const where = {
    branchId: { in: scope.branchIds },
    registeredAt: { gte: scope.from, lt: scope.to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.q
      ? {
          OR: [
            { patient: { publicRef: { contains: sp.q.toUpperCase() } } },
            { visitNumber: { contains: sp.q.toUpperCase() } },
            { patient: { firstName: { contains: sp.q } } },
            { patient: { lastName: { contains: sp.q } } },
          ],
        }
      : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, visits, branches, newPatients, returningVisits, referralCounts] = await Promise.all([
    db.visit.count({ where }),
    db.visit.findMany({
      where,
      include: {
        patient: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { registeredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.patient.count({ where: { createdAt: { gte: scope.from, lt: scope.to } } }),
    db.visit.groupBy({
      by: ["patientId"],
      where: { branchId: { in: scope.branchIds }, registeredAt: { gte: scope.from, lt: scope.to } },
      _count: { id: true },
    }),
    db.referral.groupBy({
      by: ["referralDoctorId"],
      where: { branchId: { in: scope.branchIds }, createdAt: { gte: scope.from, lt: scope.to } },
      _count: { id: true },
    }),
  ]);

  const returning = returningVisits.filter((r) => r._count.id > 1).length;
  const referralDoctors = await db.referralDoctor.findMany({
    where: { id: { in: referralCounts.map((r) => r.referralDoctorId) } },
    select: { id: true, name: true },
  });
  const referralNames = new Map(referralDoctors.map((d) => [d.id, d.name]));

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/patients?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Patient Intelligence"
        subtitle="Management view of patient volume and flow. Names are masked; diagnosis, scans, contact details and report text are never shown here."
        actions={<ExportCsvButton filename="merna-patient-visits.csv" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Visits (period)" value={fmtNumber(stats.total)} />
        <KpiCard label="New patients" value={fmtNumber(newPatients)} definition="Patient records created in the period." />
        <KpiCard label="Returning patients" value={fmtNumber(returning)} definition="Patients with more than one visit in the period." />
        <KpiCard label="Completion rate" value={stats.completionRate !== null ? fmtPercent(stats.completionRate * 100) : "—"} />
        <KpiCard label="Average wait" value={stats.avgWaitMinutes !== null ? fmtDuration(stats.avgWaitMinutes) : "—"} />
        <KpiCard label="Cancellation rate" value={stats.total > 0 ? fmtPercent((stats.cancelled / stats.total) * 100) : "—"} />
        <KpiCard label="Report turnaround" value={stats.avgReportTurnaroundHours !== null ? `${stats.avgReportTurnaroundHours.toFixed(1)}h` : "—"} />
        <KpiCard label="In queues now" value={fmtNumber(stats.inQueue)} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Visits by department" />
          <CardBody>
            {stats.byDepartmentType.length ? (
              <HBarList
                items={stats.byDepartmentType.map((d) => ({
                  label: DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type,
                  value: d.count,
                }))}
              />
            ) : (
              <p className="py-6 text-center text-[13px] text-mute">No visits in this period.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Referral sources" subtitle="Visits attributed to referral doctors" />
          <CardBody>
            {referralCounts.length ? (
              <HBarList
                items={referralCounts
                  .sort((a, b) => b._count.id - a._count.id)
                  .slice(0, 8)
                  .map((r) => ({ label: `Dr. ${referralNames.get(r.referralDoctorId) ?? "Unknown"}`, value: r._count.id }))}
              />
            ) : (
              <p className="py-6 text-center text-[13px] text-mute">No referral-attributed visits in this period.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Privacy model" subtitle="Why this view is masked" />
          <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-body">
            <p className="flex items-start gap-2">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-deep" />
              Patients carry an immutable internal ID plus a non-guessable public reference (MRN-…). Receipts and
              report-verification QR tokens reference visits without exposing identity or medical content.
            </p>
            <p>
              Full contact details, diagnosis, raw scans and report text are restricted to operational roles at the
              branch. Every access to patient data is audit-logged. Consent and privacy-notice versions are stored per
              patient.
            </p>
          </CardBody>
        </Card>
      </div>

      {total === 0 && !sp.q && !sp.branch && !sp.status ? (
        <EmptyState
          icon={<HeartPulse size={18} strokeWidth={1.5} />}
          title="No visits in this period"
          description="Visits appear when patients are registered at a department queue."
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search MRN, visit number, name…" className="w-full sm:w-64" />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
            <FilterSelect
              param="status"
              label="Status"
              allLabel="All statuses"
              options={Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Toolbar>

          <div id="export-region">
            <TableShell dense>
              <THead>
                <Th>Reference</Th><Th>Patient</Th><Th>Age range</Th><Th>Branch</Th><Th>Department</Th>
                <Th>Visit status</Th><Th>Payment</Th><Th>Report</Th><Th>QR</Th><Th align="right">Date</Th>
              </THead>
              <tbody>
                {visits.length === 0 && <TableEmpty colSpan={10}>No visits match the current filters.</TableEmpty>}
                {visits.map((v) => (
                  <Tr key={v.id}>
                    <Td mono>
                      {v.patient.publicRef}
                      <span className="block text-[10px] text-mute">{v.visitNumber}</span>
                    </Td>
                    <Td className="font-medium text-ink">{maskName(v.patient.firstName, v.patient.lastName)}</Td>
                    <Td>{ageRange(v.patient.birthYear)}</Td>
                    <Td>{v.branch.name}</Td>
                    <Td>{v.department.name}</Td>
                    <Td><Badge tone={statusTone(v.status)}>{VISIT_STATUS_LABELS[v.status as keyof typeof VISIT_STATUS_LABELS]}</Badge></Td>
                    <Td><Badge tone={statusTone(v.paymentStatus)} dot>{v.paymentStatus.toLowerCase()}</Badge></Td>
                    <Td>
                      {v.reportRequired
                        ? v.reportCompletedAt
                          ? <Badge tone="good">Completed</Badge>
                          : <Badge tone="warning">Pending</Badge>
                        : <span className="text-mute">n/a</span>}
                    </Td>
                    <Td>
                      <Badge tone="neutral" className="font-mono">{v.qrToken.slice(0, 6)}…</Badge>
                    </Td>
                    <Td align="right" className="text-mute">{fmtDate(v.registeredAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </div>
          <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
        </>
      )}
    </>
  );
}
