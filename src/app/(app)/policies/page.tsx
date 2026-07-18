import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, Hint } from "@/components/ui/input";
import { POLICY_CATEGORIES, POLICY_CATEGORY_LABELS } from "@/types/enums";
import { createPolicy } from "./actions";

export const metadata: Metadata = { title: "Policies" };

type Search = { q?: string; category?: string; status?: string };

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("policies");
  const sp = await searchParams;
  const writable = canWrite(user.role, "policies");

  const where = {
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.q ? { title: { contains: sp.q } } : {}),
  };

  const [policies, activeEmployees, acceptances] = await Promise.all([
    db.policy.findMany({
      where,
      include: { _count: { select: { acceptances: true } } },
      orderBy: [{ status: "asc" }, { title: "asc" }, { version: "desc" }],
    }),
    db.employee.count({ where: { employmentStatus: "ACTIVE" } }),
    db.policyAcceptance.count({ where: { policy: { status: "ACTIVE" } } }),
  ]);

  const activePolicies = policies.filter((p) => p.status === "ACTIVE").length;
  const totalSlots = activePolicies * activeEmployees;

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> New policy</>}
      triggerVariant="primary"
      title="Create policy"
      description="Created as a draft. Publish it to make it active and start collecting acceptances."
      action={createPolicy}
      submitLabel="Create draft"
      wide
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pf-title" required>Title</Label>
          <Input id="pf-title" name="title" placeholder="Attendance Policy" required />
        </div>
        <div>
          <Label htmlFor="pf-cat" required>Category</Label>
          <Select id="pf-cat" name="category" defaultValue="ATTENDANCE">
            {POLICY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{POLICY_CATEGORY_LABELS[c]}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="pf-body" required>Policy text</Label>
        <Textarea id="pf-body" name="body" required className="min-h-[180px]" placeholder="Full policy text…" />
        <Hint>Creating a policy with an existing title makes a new version of it.</Hint>
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="Versioned work policies with acceptance tracking. Employees must accept each active version."
        actions={
          <>
            <ExportCsvButton filename="merna-policies.csv" />
            {addDialog}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Active policies" value={fmtNumber(activePolicies)} />
        <KpiCard label="Draft policies" value={fmtNumber(policies.filter((p) => p.status === "DRAFT").length)} />
        <KpiCard
          label="Overall acceptance"
          value={totalSlots > 0 ? fmtPercent((acceptances / totalSlots) * 100) : "—"}
          definition="Acceptances ÷ (active policies × active employees)."
        />
        <KpiCard label="Employees in scope" value={fmtNumber(activeEmployees)} />
      </div>

      {policies.length === 0 && !sp.q && !sp.category && !sp.status ? (
        <EmptyState
          icon={<BookOpen size={18} strokeWidth={1.5} />}
          title="No policies yet"
          description="Create the company's work policies — attendance, device usage, privacy, confidentiality — and publish them for acceptance."
          action={addDialog}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search title…" className="w-full sm:w-56" />
            <FilterSelect param="category" label="Category" allLabel="All categories" options={POLICY_CATEGORIES.map((c) => ({ value: c, label: POLICY_CATEGORY_LABELS[c] }))} />
            <FilterSelect param="status" label="Status" allLabel="All statuses" options={[
              { value: "ACTIVE", label: "Active" },
              { value: "DRAFT", label: "Draft" },
              { value: "SUPERSEDED", label: "Superseded" },
            ]} />
          </Toolbar>

          <div id="export-region">
            <TableShell>
              <THead>
                <Th>Policy</Th><Th>Category</Th><Th align="center">Version</Th><Th>Status</Th>
                <Th align="right">Effective</Th><Th align="right">Acceptances</Th><Th align="right">Acceptance rate</Th>
              </THead>
              <tbody>
                {policies.length === 0 && <TableEmpty colSpan={7}>No policies match the current filters.</TableEmpty>}
                {policies.map((p) => {
                  const rate = p.status === "ACTIVE" && activeEmployees > 0
                    ? (p._count.acceptances / activeEmployees) * 100
                    : null;
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`/policies/${p.id}`} className="font-medium text-ink hover:underline">{p.title}</Link>
                        <span className="block text-[10.5px] text-mute">
                          {p.authorName ? `Author: ${p.authorName}` : ""}{p.approverName ? ` · Approved: ${p.approverName}` : ""}
                        </span>
                      </Td>
                      <Td>{POLICY_CATEGORY_LABELS[p.category as keyof typeof POLICY_CATEGORY_LABELS] ?? p.category}</Td>
                      <Td align="center" mono>v{p.version}</Td>
                      <Td><Badge tone={statusTone(p.status)} dot>{p.status.toLowerCase()}</Badge></Td>
                      <Td align="right" className="text-mute">{p.effectiveDate ? fmtDate(p.effectiveDate) : "—"}</Td>
                      <Td align="right">{fmtNumber(p._count.acceptances)}</Td>
                      <Td align="right" className={rate !== null && rate < 100 ? "text-warning-deep" : undefined}>
                        {rate !== null ? fmtPercent(rate) : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        </>
      )}
    </>
  );
}
