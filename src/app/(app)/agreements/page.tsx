import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { maskingFor } from "@/lib/permissions";
import { fmtDateTime, fmtNumber, fmtPercent, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { AGREEMENT_STATUSES, AGREEMENT_STATUS_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Agreements" };

const PAGE_SIZE = 25;

type Search = { q?: string; status?: string; branch?: string; page?: string };

export default async function AgreementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("agreements");
  const scope = await getScope(user);
  const sp = await searchParams;
  const masking = maskingFor(user.role);

  const where = {
    branchId: { in: scope.branchIds },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.q
      ? {
          OR: [
            { title: { contains: sp.q } },
            { employee: { OR: [{ firstName: { contains: sp.q } }, { lastName: { contains: sp.q } }, { employeeCode: { contains: sp.q } }] } },
          ],
        }
      : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, agreements, branches, activeEmployees, acceptedCount, issuedCount] = await Promise.all([
    db.agreement.count({ where }),
    db.agreement.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, jobTitle: true } },
        branch: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employee.count({ where: { branchId: { in: scope.branchIds }, employmentStatus: "ACTIVE" } }),
    db.employee.count({
      where: { branchId: { in: scope.branchIds }, employmentStatus: "ACTIVE", agreements: { some: { status: "ACCEPTED" } } },
    }),
    db.agreement.count({ where: { branchId: { in: scope.branchIds }, status: "ISSUED" } }),
  ]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/agreements?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Employee Agreements"
        subtitle="Versioned employment agreements with acceptance evidence. Agreements are issued and accepted from each employee's page."
        actions={<ExportCsvButton filename="merna-agreements.csv" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Active employees" value={fmtNumber(activeEmployees)} />
        <KpiCard
          label="With accepted agreement"
          value={activeEmployees > 0 ? fmtPercent((acceptedCount / activeEmployees) * 100) : "—"}
          tone={activeEmployees > 0 && acceptedCount < activeEmployees ? "warning" : undefined}
          definition="Active employees who have at least one accepted agreement."
        />
        <KpiCard label="Awaiting acceptance" value={fmtNumber(issuedCount)} tone={issuedCount > 0 ? "warning" : undefined} />
        <KpiCard label="Total agreement versions" value={fmtNumber(total)} />
      </div>

      {total === 0 && !sp.q && !sp.status && !sp.branch ? (
        <EmptyState
          icon={<FileSignature size={18} strokeWidth={1.5} />}
          title="No agreements yet"
          description="Issue employment agreements from an employee's page (Agreements tab). Each version is locked and hashed on acceptance."
          action={<Link href="/employees" className="text-[13px] font-medium text-link hover:underline">Go to employees</Link>}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search employee or title…" className="w-full sm:w-64" />
            <FilterSelect param="status" label="Status" allLabel="All statuses" options={AGREEMENT_STATUSES.map((s) => ({ value: s, label: AGREEMENT_STATUS_LABELS[s] }))} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                <Th>Agreement</Th><Th>Employee</Th><Th>Branch</Th><Th align="center">Version</Th>
                <Th>Status</Th><Th>Evidence</Th><Th align="right">Issued</Th><Th align="right">Accepted</Th>
              </THead>
              <tbody>
                {agreements.length === 0 && <TableEmpty colSpan={8}>No agreements match the current filters.</TableEmpty>}
                {agreements.map((a) => (
                  <Tr key={a.id}>
                    <Td className="font-medium text-ink">{a.title}</Td>
                    <Td>
                      <Link href={`/employees/${a.employee.id}?tab=agreements`} className="hover:underline">
                        {masking.employeeContact ? maskName(a.employee.firstName, a.employee.lastName) : `${a.employee.firstName} ${a.employee.lastName}`}
                      </Link>
                      <span className="block text-[10.5px] text-mute">{a.employee.jobTitle}</span>
                    </Td>
                    <Td>{a.branch.name}</Td>
                    <Td align="center" mono>v{a.version}</Td>
                    <Td><Badge tone={statusTone(a.status)} dot>{AGREEMENT_STATUS_LABELS[a.status as keyof typeof AGREEMENT_STATUS_LABELS]}</Badge></Td>
                    <Td>
                      {a.status === "ACCEPTED" ? (
                        <span className="flex flex-wrap gap-1">
                          {a.otpVerified && <Badge tone="good">OTP</Badge>}
                          {a.deviceRecorded && <Badge tone="good">Device</Badge>}
                          {a.networkRecorded && <Badge tone="good">Network</Badge>}
                          {a.locationRecorded && <Badge tone="good">Location</Badge>}
                          {a.pdfHash && <Badge tone="neutral">Hashed</Badge>}
                          {!a.otpVerified && !a.deviceRecorded && !a.networkRecorded && !a.locationRecorded && (
                            <Badge tone="warning">No evidence flags</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </Td>
                    <Td align="right" className="text-mute">{fmtDateTime(a.issuedAt)}</Td>
                    <Td align="right" className="text-mute">{fmtDateTime(a.acceptedAt)}</Td>
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
