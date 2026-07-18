import type { Metadata } from "next";
import { BadgePercent, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { fmtDateTime, fmtIQD, fmtIQDCompact, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, FilterSelect } from "@/components/ui/toolbar";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionButton, ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, Hint } from "@/components/ui/input";
import { requestDiscount, decideDiscount, createDiscountCode, toggleDiscountCode } from "../actions";

export const metadata: Metadata = { title: "Discounts" };

type Search = { status?: string; branch?: string };

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("finance.discounts");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "finance.discounts");

  const where = {
    branchId: { in: scope.branchIds },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.status ? { status: sp.status } : {}),
  };

  const [requests, codes, branches, approvedAgg, pendingCount] = await Promise.all([
    db.discountRequest.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        department: { select: { name: true } },
        visit: { select: { visitNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.discountCode.findMany({ orderBy: { createdAt: "desc" } }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.discountRequest.aggregate({
      where: { branchId: { in: scope.branchIds }, status: "APPROVED", createdAt: { gte: scope.from, lt: scope.to } },
      _count: { id: true },
    }),
    db.discountRequest.count({ where: { branchId: { in: scope.branchIds }, status: "PENDING" } }),
  ]);

  const approvedValue = await db.discountRequest.findMany({
    where: { branchId: { in: scope.branchIds }, status: "APPROVED", createdAt: { gte: scope.from, lt: scope.to } },
    select: { oldPrice: true, newPrice: true },
  });
  const approvedTotal = approvedValue.reduce((s, r) => s + (r.oldPrice - r.newPrice), 0);

  return (
    <>
      <PageHeader
        title="Discounts"
        subtitle="Reception cannot change prices directly — every discount is a request that must be approved. Codes and referral conversions are audited."
        actions={
          <>
            <ExportCsvButton filename="merna-discounts.csv" />
            {writable && (
              <ActionDialog
                trigger={<><Plus size={14} /> Request discount</>}
                triggerVariant="primary"
                title="Request a discount"
                description="Approval is required before the discount applies. If linked to a visit, approval applies it automatically."
                action={requestDiscount}
                submitLabel="Submit request"
              >
                {!isBranchScoped(user.role) && (
                  <div>
                    <Label htmlFor="dr-branch" required>Branch</Label>
                    <Select id="dr-branch" name="branchId" required defaultValue={branches[0]?.id}>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dr-old" required>Current price (IQD)</Label>
                    <Input id="dr-old" name="oldPrice" type="number" min={1} step="1000" required />
                  </div>
                  <div>
                    <Label htmlFor="dr-new" required>Requested price (IQD)</Label>
                    <Input id="dr-new" name="newPrice" type="number" min={0} step="1000" required />
                  </div>
                </div>
                <div>
                  <Label htmlFor="dr-reason" required>Reason</Label>
                  <Textarea id="dr-reason" name="reason" required placeholder="Why is this discount justified?" />
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Pending requests" value={fmtNumber(pendingCount)} tone={pendingCount > 0 ? "warning" : undefined} />
        <KpiCard label="Approved (period)" value={fmtNumber(approvedAgg._count.id)} />
        <KpiCard label="Approved value (period)" value={fmtIQDCompact(approvedTotal)} />
        <KpiCard label="Active codes" value={fmtNumber(codes.filter((c) => c.active).length)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Toolbar>
            <FilterSelect param="status" label="Status" allLabel="All statuses" options={[
              { value: "PENDING", label: "Pending" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
            ]} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
          </Toolbar>

          {requests.length === 0 ? (
            <EmptyState
              icon={<BadgePercent size={18} strokeWidth={1.5} />}
              title="No discount requests"
              description="Requests appear here when reception or managers ask for a price reduction on a visit."
            />
          ) : (
            <div id="export-region">
              <TableShell dense>
                <THead>
                  <Th>Requested</Th><Th>Branch</Th><Th>Type</Th><Th align="right">Old</Th><Th align="right">New</Th>
                  <Th align="right">Value</Th><Th>Reason</Th><Th>By</Th><Th>Status</Th>
                  {writable && <Th align="right">Decide</Th>}
                </THead>
                <tbody>
                  {requests.map((r) => (
                    <Tr key={r.id} highlight={r.status === "PENDING"}>
                      <Td className="whitespace-nowrap text-mute">{fmtDateTime(r.createdAt)}</Td>
                      <Td>
                        {r.branch.name}
                        {r.visit && <span className="block font-mono text-[10px] text-mute">{r.visit.visitNumber}</span>}
                      </Td>
                      <Td>
                        <Badge tone={r.type === "REFERRAL_CONVERSION" ? "ai" : r.type === "CODE" ? "ok" : "neutral"}>
                          {r.type === "REFERRAL_CONVERSION" ? "Referral" : r.type === "CODE" ? `Code ${r.code ?? ""}` : "Manual"}
                        </Badge>
                      </Td>
                      <Td align="right">{fmtIQD(r.oldPrice)}</Td>
                      <Td align="right">{fmtIQD(r.newPrice)}</Td>
                      <Td align="right" className="font-medium text-ink">{fmtIQD(r.oldPrice - r.newPrice)}</Td>
                      <Td className="max-w-44"><span className="block truncate" title={r.reason}>{r.reason}</span></Td>
                      <Td className="text-mute">{r.requestedByName}</Td>
                      <Td><Badge tone={statusTone(r.status)} dot>{r.status.toLowerCase()}</Badge></Td>
                      {writable && (
                        <Td align="right">
                          {r.status === "PENDING" && (
                            <ActionDialog
                              trigger="Decide"
                              triggerSize="sm"
                              title={`Discount decision — ${fmtIQD(r.oldPrice - r.newPrice)}`}
                              description={`${r.reason} · requested by ${r.requestedByName}`}
                              action={decideDiscount}
                              submitLabel="Apply decision"
                            >
                              <input type="hidden" name="requestId" value={r.id} />
                              <div>
                                <Label htmlFor={`dd-${r.id}`} required>Decision</Label>
                                <Select id={`dd-${r.id}`} name="decision" defaultValue="APPROVED">
                                  <option value="APPROVED">Approve</option>
                                  <option value="REJECTED">Reject</option>
                                </Select>
                              </div>
                              <div>
                                <Label htmlFor={`dn-${r.id}`}>Note</Label>
                                <Textarea id={`dn-${r.id}`} name="reason" placeholder="Required when rejecting" />
                              </div>
                            </ActionDialog>
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          )}
        </div>

        <Card>
          <CardHeader
            title="Discount codes"
            subtitle="Applied at payment — usage is audited"
            actions={
              writable ? (
                <ActionDialog
                  trigger={<><Plus size={12} /> Code</>}
                  triggerSize="sm"
                  title="Create discount code"
                  action={createDiscountCode}
                  submitLabel="Create code"
                >
                  <div>
                    <Label htmlFor="dc-code" required>Code</Label>
                    <Input id="dc-code" name="code" placeholder="RAMADAN-25" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="dc-pct">Percent off</Label>
                      <Input id="dc-pct" name="percent" type="number" min={0} max={100} step="1" />
                    </div>
                    <div>
                      <Label htmlFor="dc-amt">Or fixed amount</Label>
                      <Input id="dc-amt" name="amount" type="number" min={0} step="1000" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="dc-max">Max uses</Label>
                      <Input id="dc-max" name="maxUses" type="number" min={0} />
                    </div>
                    <div>
                      <Label htmlFor="dc-from">Valid from</Label>
                      <Input id="dc-from" name="validFrom" type="date" />
                    </div>
                    <div>
                      <Label htmlFor="dc-to">Valid to</Label>
                      <Input id="dc-to" name="validTo" type="date" />
                    </div>
                  </div>
                  <Hint>Set percent or amount — percent wins if both are set.</Hint>
                </ActionDialog>
              ) : undefined
            }
          />
          <CardBody>
            {codes.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-mute">No discount codes created.</p>
            ) : (
              <ul className="space-y-2.5">
                {codes.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                    <div>
                      <p className="font-mono text-[13px] font-medium text-ink">{c.code}</p>
                      <p className="text-[11.5px] text-mute">
                        {c.percent ? `${c.percent}% off` : fmtIQD(c.amount ?? 0)} · used {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={c.active ? "good" : "neutral"} dot>{c.active ? "Active" : "Inactive"}</Badge>
                      {writable && (
                        <ActionButton
                          label={c.active ? "Disable" : "Enable"}
                          variant="ghost"
                          size="sm"
                          action={toggleDiscountCode}
                          hidden={{ codeId: c.id }}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
