import type { Metadata } from "next";
import { Plus, TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtDateTime, fmtIQD, fmtIQDCompact, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/types/enums";
import { createIncomeEntry } from "../actions";

export const metadata: Metadata = { title: "Income" };

const PAGE_SIZE = 30;

type Search = { q?: string; method?: string; category?: string; branch?: string; page?: string };

export default async function IncomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("finance.income");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "finance.income");

  const where = {
    branchId: { in: scope.branchIds },
    receivedAt: { gte: scope.from, lt: scope.to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.method ? { method: sp.method } : {}),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.q ? { description: { contains: sp.q } } : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, entries, sums, byMethod, byCategory, branches, outstanding, partials] = await Promise.all([
    db.incomeEntry.count({ where }),
    db.incomeEntry.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        department: { select: { name: true } },
        visit: { select: { visitNumber: true } },
      },
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.incomeEntry.aggregate({ where, _sum: { amount: true } }),
    db.incomeEntry.groupBy({ by: ["method"], where, _sum: { amount: true } }),
    db.incomeEntry.groupBy({ by: ["category"], where, _sum: { amount: true } }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.visit.aggregate({
      where: { branchId: { in: scope.branchIds }, paymentStatus: "UNPAID", status: { notIn: ["CANCELLED"] } },
      _sum: { price: true }, _count: { id: true },
    }),
    db.visit.count({ where: { branchId: { in: scope.branchIds }, paymentStatus: "PARTIAL" } }),
  ]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/finance/income?${params.toString()}`;
  };

  const methodSum = (m: string) => byMethod.find((x) => x.method === m)?._sum.amount ?? 0;
  const patientIncome = byCategory.find((c) => c.category === "PATIENT_SERVICE")?._sum.amount ?? 0;
  const otherIncome = byCategory.find((c) => c.category === "OTHER")?._sum.amount ?? 0;

  const departments = await db.department.findMany({
    where: { branchId: { in: scope.branchIds } },
    select: { id: true, name: true, branch: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Record income</>}
      triggerVariant="primary"
      title="Record other income"
      description="Patient-service income is recorded automatically when visit payments are taken at the queue. Use this for other income."
      action={createIncomeEntry}
      submitLabel="Record"
    >
      {!isBranchScoped(user.role) && (
        <div>
          <Label htmlFor="in-branch" required>Branch</Label>
          <Select id="in-branch" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      )}
      <div>
        <Label htmlFor="in-dept">Department</Label>
        <Select id="in-dept" name="departmentId" defaultValue="">
          <option value="">— None —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.branch.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="in-desc" required>Description</Label>
        <Input id="in-desc" name="description" placeholder="e.g. Equipment rental income" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="in-amount" required>Amount (IQD)</Label>
          <Input id="in-amount" name="amount" type="number" min={1} step="1000" required />
        </div>
        <div>
          <Label htmlFor="in-method">Method</Label>
          <Select id="in-method" name="method" defaultValue="CASH">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="in-date">Received date</Label>
        <Input id="in-date" name="receivedAt" type="date" />
        <Hint>Defaults to today.</Hint>
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Income"
        subtitle="Collected amounts in the selected scope and period, by source and method."
        actions={<>
          <ExportCsvButton filename="merna-income.csv" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Net collected" value={fmtIQDCompact(sums._sum.amount ?? 0)} />
        <KpiCard label="Patient services" value={fmtIQDCompact(patientIncome)} />
        <KpiCard label="Other income" value={fmtIQDCompact(otherIncome)} />
        <KpiCard label="Cash" value={fmtIQDCompact(methodSum("CASH"))} />
        <KpiCard label="Card" value={fmtIQDCompact(methodSum("CARD"))} />
        <KpiCard label="Bank transfer" value={fmtIQDCompact(methodSum("TRANSFER"))} />
        <KpiCard
          label="Outstanding invoices"
          value={fmtIQDCompact(outstanding._sum.price ?? 0)}
          tone={(outstanding._count.id ?? 0) > 0 ? "warning" : undefined}
          definition={`${fmtNumber(outstanding._count.id)} unpaid visits · ${fmtNumber(partials)} partial payments.`}
        />
      </div>

      {total === 0 && !sp.q && !sp.method && !sp.branch && !sp.category ? (
        <EmptyState
          icon={<TrendingUp size={18} strokeWidth={1.5} />}
          title="No income in this period"
          description="Income appears here when visit payments are recorded at the queue or other income is entered manually."
          action={addDialog}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search description…" className="w-full sm:w-56" />
            <FilterSelect param="category" label="Category" allLabel="All sources" options={[
              { value: "PATIENT_SERVICE", label: "Patient services" },
              { value: "OTHER", label: "Other income" },
            ]} />
            <FilterSelect param="method" label="Method" allLabel="All methods" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                <Th>Received</Th><Th>Description</Th><Th>Branch</Th><Th>Department</Th>
                <Th>Source</Th><Th>Method</Th><Th>Recorded by</Th><Th align="right">Amount</Th>
              </THead>
              <tbody>
                {entries.length === 0 && <TableEmpty colSpan={8}>No income entries match the current filters.</TableEmpty>}
                {entries.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-mute">{fmtDateTime(e.receivedAt)}</Td>
                    <Td className="max-w-64">
                      <span className="block truncate font-medium text-ink">{e.description ?? "Patient service payment"}</span>
                      {e.visit && <span className="font-mono text-[10.5px] text-mute">{e.visit.visitNumber}</span>}
                    </Td>
                    <Td>{e.branch.name}</Td>
                    <Td>{e.department?.name ?? "—"}</Td>
                    <Td><Badge tone={e.category === "PATIENT_SERVICE" ? "ok" : "neutral"}>{e.category === "PATIENT_SERVICE" ? "Patient service" : "Other"}</Badge></Td>
                    <Td>{PAYMENT_METHOD_LABELS[e.method as keyof typeof PAYMENT_METHOD_LABELS] ?? e.method}</Td>
                    <Td className="text-mute">{e.recordedByName}</Td>
                    <Td align="right" className="font-medium text-ink">{fmtIQD(e.amount)}</Td>
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
