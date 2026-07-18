import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, maskingFor } from "@/lib/permissions";
import { fmtDate, maskName, maskPhone } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, ThSort, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS } from "@/types/enums";
import { createEmployee } from "./actions";

export const metadata: Metadata = { title: "Employees" };

const PAGE_SIZE = 25;

type Search = { q?: string; status?: string; branch?: string; department?: string; sort?: string; dir?: string; page?: string };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("employees");
  const scope = await getScope(user);
  const sp = await searchParams;
  const masking = maskingFor(user.role);
  const writable = canWrite(user.role, "employees");

  const where = {
    branchId: { in: scope.branchIds },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.status ? { employmentStatus: sp.status } : {}),
    ...(sp.department ? { departmentId: sp.department } : {}),
    ...(sp.q
      ? {
          OR: [
            { firstName: { contains: sp.q } },
            { lastName: { contains: sp.q } },
            { employeeCode: { contains: sp.q } },
            { jobTitle: { contains: sp.q } },
          ],
        }
      : {}),
  };

  const sort = sp.sort ?? "startDate";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const orderBy =
    sort === "name" ? [{ firstName: dir }] :
    sort === "title" ? [{ jobTitle: dir }] :
    sort === "salary" ? [{ baseSalary: dir }] :
    [{ startDate: dir }];

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, employees, branches, departments, agreementByEmployee] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        department: { select: { name: true } },
        user: { select: { lastLoginAt: true, isActive: true } },
      },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ where: { branchId: { in: scope.branchIds } }, select: { id: true, name: true, branch: { select: { name: true } } }, orderBy: { name: "asc" } }),
    db.agreement.groupBy({
      by: ["employeeId", "status"],
      where: { employee: { branchId: { in: scope.branchIds } } },
    }),
  ]);

  const acceptedSet = new Set(agreementByEmployee.filter((a) => a.status === "ACCEPTED").map((a) => a.employeeId));
  const issuedSet = new Set(agreementByEmployee.filter((a) => a.status === "ISSUED").map((a) => a.employeeId));

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...overrides })) {
      if (v) params.set(k, v);
    }
    return `/employees?${params.toString()}`;
  };

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Add employee</>}
      triggerVariant="primary"
      title="Add employee"
      description="Creates the employee record. Issue the employment agreement afterwards from the employee page."
      action={createEmployee}
      submitLabel="Create employee"
      wide
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="ef-first" required>First name</Label>
          <Input id="ef-first" name="firstName" required />
        </div>
        <div>
          <Label htmlFor="ef-last" required>Last name</Label>
          <Input id="ef-last" name="lastName" required />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ef-title" required>Job title</Label>
          <Input id="ef-title" name="jobTitle" placeholder="Radiology Technician" required />
        </div>
        <div>
          <Label htmlFor="ef-branch" required>Branch</Label>
          <Select id="ef-branch" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="ef-dept">Department</Label>
        <Select id="ef-dept" name="departmentId" defaultValue="">
          <option value="">— No department (branch-level) —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name} · {d.branch.name}</option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ef-email">Email</Label>
          <Input id="ef-email" name="email" type="email" />
        </div>
        <div>
          <Label htmlFor="ef-phone">Phone</Label>
          <Input id="ef-phone" name="phone" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="ef-start">Start date</Label>
          <Input id="ef-start" name="startDate" type="date" />
        </div>
        <div>
          <Label htmlFor="ef-salary">Base salary (IQD)</Label>
          <Input id="ef-salary" name="baseSalary" type="number" min={0} step="10000" />
        </div>
        <div>
          <Label htmlFor="ef-ws">Shift start</Label>
          <Input id="ef-ws" name="workScheduleStart" defaultValue="08:30" />
        </div>
        <div>
          <Label htmlFor="ef-we">Shift end</Label>
          <Input id="ef-we" name="workScheduleEnd" defaultValue="17:00" />
        </div>
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Workforce registry across the group — positions, agreements, attendance and access."
        actions={
          <>
            <ExportCsvButton filename="merna-employees.csv" />
            {addDialog}
          </>
        }
      />

      {total === 0 && !sp.q && !sp.status && !sp.branch && !sp.department ? (
        <EmptyState
          icon={<Users size={18} strokeWidth={1.5} />}
          title="No employees yet"
          description={branches.length === 0
            ? "Create a branch first, then register its employees."
            : "Register the first employee to start workforce management."}
          action={branches.length === 0
            ? <Link href="/branches" className="text-[13px] font-medium text-link hover:underline">Go to branches</Link>
            : addDialog}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search name, code, title…" className="w-full sm:w-64" />
            <FilterSelect param="status" label="Status" allLabel="All statuses" options={EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_STATUS_LABELS[s] }))} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
            <FilterSelect param="department" label="Department" allLabel="All departments" options={departments.map((d) => ({ value: d.id, label: `${d.name} · ${d.branch.name}` }))} />
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                <ThSort label="Employee" sortKey="name" currentSort={sort} currentDir={dir} makeHref={(s, d2) => makeHref({ sort: s, dir: d2 })} />
                <ThSort label="Job title" sortKey="title" currentSort={sort} currentDir={dir} makeHref={(s, d2) => makeHref({ sort: s, dir: d2 })} />
                <Th>Branch</Th>
                <Th>Department</Th>
                <Th>Status</Th>
                <Th>Agreement</Th>
                <Th>Contact</Th>
                <ThSort label="Start" sortKey="startDate" currentSort={sort} currentDir={dir} makeHref={(s, d2) => makeHref({ sort: s, dir: d2 })} align="right" />
              </THead>
              <tbody>
                {employees.length === 0 && <TableEmpty colSpan={8}>No employees match the current filters.</TableEmpty>}
                {employees.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <Link href={`/employees/${e.id}`} className="font-medium text-ink hover:underline">
                        {masking.employeeContact ? maskName(e.firstName, e.lastName) : `${e.firstName} ${e.lastName}`}
                      </Link>
                      <span className="block font-mono text-[10.5px] text-mute">{e.employeeCode}</span>
                    </Td>
                    <Td>{e.jobTitle}</Td>
                    <Td>{e.branch.name}</Td>
                    <Td>{e.department?.name ?? "—"}</Td>
                    <Td><Badge tone={statusTone(e.employmentStatus)} dot>{EMPLOYMENT_STATUS_LABELS[e.employmentStatus as keyof typeof EMPLOYMENT_STATUS_LABELS]}</Badge></Td>
                    <Td>
                      {acceptedSet.has(e.id) ? (
                        <Badge tone="good">Accepted</Badge>
                      ) : issuedSet.has(e.id) ? (
                        <Badge tone="warning">Awaiting acceptance</Badge>
                      ) : (
                        <Badge tone="critical">Missing</Badge>
                      )}
                    </Td>
                    <Td className="text-mute">{masking.employeeContact ? maskPhone(e.phone) : e.phone ?? "—"}</Td>
                    <Td align="right">{fmtDate(e.startDate)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </div>
          <Pagination page={page} pageCount={pageCount} total={total} makeHref={(p) => makeHref({ page: String(p) })} />
        </>
      )}
    </>
  );
}
