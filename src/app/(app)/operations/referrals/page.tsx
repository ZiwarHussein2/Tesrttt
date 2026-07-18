import type { Metadata } from "next";
import { Plus, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite } from "@/lib/permissions";
import { fmtIQD, fmtIQDCompact, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, Hint } from "@/components/ui/input";
import { DEAL_TYPES, DEAL_TYPE_LABELS } from "@/types/enums";
import { createReferralDoctor, recordDoctorPayment, updateReferralDeal } from "../doctors-actions";

export const metadata: Metadata = { title: "Referral Doctors" };

export default async function ReferralsPage() {
  const user = await requireUser("referrals");
  const scope = await getScope(user);
  const writable = canWrite(user.role, "referrals");

  const doctors = await db.referralDoctor.findMany({
    include: {
      referrals: {
        where: { branchId: { in: scope.branchIds } },
        include: { visit: { select: { price: true, paidAmount: true, registeredAt: true } } },
      },
      payments: { select: { amount: true } },
    },
    orderBy: { name: "asc" },
  });

  const periodReferrals = doctors.flatMap((d) =>
    d.referrals.filter((r) => r.visit.registeredAt >= scope.from && r.visit.registeredAt < scope.to),
  );
  const totalCommissionLiability = doctors.reduce(
    (s, d) => s + d.referrals.filter((r) => !r.convertedToDiscount).reduce((x, r) => x + r.commissionAmount, 0) - d.payments.reduce((x, p) => x + p.amount, 0),
    0,
  );
  const attributedRevenue = periodReferrals.reduce((s, r) => s + r.visit.paidAmount, 0);

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Referral doctor</>}
      triggerVariant="primary"
      title="Add referral doctor"
      description="Define the deal: fixed commission per referred patient, a percentage, no commission, or commission converted into a patient discount."
      action={createReferralDoctor}
      submitLabel="Add doctor"
    >
      <div>
        <Label htmlFor="rf-name" required>Name</Label>
        <Input id="rf-name" name="name" placeholder="Doctor's full name" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="rf-spec">Specialty</Label>
          <Input id="rf-spec" name="specialty" />
        </div>
        <div>
          <Label htmlFor="rf-phone">Phone</Label>
          <Input id="rf-phone" name="phone" />
        </div>
      </div>
      <div>
        <Label htmlFor="rf-deal" required>Deal type</Label>
        <Select id="rf-deal" name="dealType" defaultValue="FIXED">
          {DEAL_TYPES.map((d) => <option key={d} value={d}>{DEAL_TYPE_LABELS[d]}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="rf-fixed">Fixed amount (IQD)</Label>
          <Input id="rf-fixed" name="fixedAmount" type="number" min={0} step="1000" placeholder="10,000" />
        </div>
        <div>
          <Label htmlFor="rf-pct">Percentage (%)</Label>
          <Input id="rf-pct" name="percent" type="number" min={0} max={100} step="0.5" />
        </div>
      </div>
      <Hint>Fixed amount applies to fixed and discount-conversion deals; percentage to percent deals.</Hint>
      <div>
        <Label htmlFor="rf-notes">Notes</Label>
        <Textarea id="rf-notes" name="notes" />
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Referral Doctors & Partners"
        subtitle="Referral deals, attributed volume and commission liabilities. Referrals are attributed at patient registration."
        actions={<>
          <ExportCsvButton filename="merna-referrals.csv" />
          {addDialog}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Active partners" value={fmtNumber(doctors.filter((d) => d.contractStatus === "ACTIVE").length)} />
        <KpiCard label="Referrals (period)" value={fmtNumber(periodReferrals.length)} />
        <KpiCard label="Attributed revenue (period)" value={fmtIQDCompact(attributedRevenue)} definition="Paid amounts on visits referred in the period." />
        <KpiCard label="Outstanding commissions" value={fmtIQDCompact(Math.max(0, totalCommissionLiability))} tone={totalCommissionLiability > 0 ? "warning" : undefined} />
      </div>

      {doctors.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={18} strokeWidth={1.5} />}
          title="No referral doctors yet"
          description="Add referring doctors and their deals: fixed commission per referred patient, a percentage of the visit price, no commission, or a commission converted into a patient discount."
          action={addDialog}
        />
      ) : (
        <Card>
          <CardHeader title="Partners" subtitle="Deal changes require a reason and are audited as high-risk" />
          <div id="export-region">
            <TableShell className="rounded-t-none shadow-none" dense>
              <THead>
                <Th>Doctor</Th><Th>Deal</Th><Th align="right">Referrals (period)</Th>
                <Th align="right">Attributed revenue</Th><Th align="right">Commission earned</Th>
                <Th align="right">Converted to discounts</Th><Th align="right">Paid</Th><Th align="right">Outstanding</Th>
                <Th>Contract</Th>
                {writable && <Th align="right">Actions</Th>}
              </THead>
              <tbody>
                {doctors.map((d) => {
                  const period = d.referrals.filter((r) => r.visit.registeredAt >= scope.from && r.visit.registeredAt < scope.to);
                  const commissionEarned = d.referrals.filter((r) => !r.convertedToDiscount).reduce((s, r) => s + r.commissionAmount, 0);
                  const converted = d.referrals.filter((r) => r.convertedToDiscount).length;
                  const paid = d.payments.reduce((s, p) => s + p.amount, 0);
                  const outstanding = Math.max(0, commissionEarned - paid);
                  return (
                    <Tr key={d.id}>
                      <Td>
                        <span className="font-medium text-ink">Dr. {d.name}</span>
                        <span className="block text-[10.5px] text-mute">{d.specialty ?? ""}</span>
                      </Td>
                      <Td>
                        <Badge tone={d.dealType === "DISCOUNT_CONVERSION" ? "ai" : "neutral"}>
                          {DEAL_TYPE_LABELS[d.dealType as keyof typeof DEAL_TYPE_LABELS]}
                        </Badge>
                        <span className="block text-[10.5px] text-mute">
                          {d.dealType === "PERCENT" ? `${d.percent}%` : d.fixedAmount ? fmtIQD(d.fixedAmount) : ""}
                        </span>
                      </Td>
                      <Td align="right">{fmtNumber(period.length)}</Td>
                      <Td align="right">{fmtIQDCompact(period.reduce((s, r) => s + r.visit.paidAmount, 0))}</Td>
                      <Td align="right">{fmtIQDCompact(commissionEarned)}</Td>
                      <Td align="right">{fmtNumber(converted)}</Td>
                      <Td align="right">{fmtIQDCompact(paid)}</Td>
                      <Td align="right" className={outstanding > 0 ? "font-medium text-warning-deep" : undefined}>{fmtIQDCompact(outstanding)}</Td>
                      <Td><Badge tone={statusTone(d.contractStatus)} dot>{d.contractStatus.toLowerCase()}</Badge></Td>
                      {writable && (
                        <Td align="right">
                          <span className="flex justify-end gap-1.5">
                            <ActionDialog
                              trigger="Deal"
                              triggerSize="sm"
                              title={`Change deal — Dr. ${d.name}`}
                              description="Deal changes affect future referrals only and are audited with your reason."
                              action={updateReferralDeal}
                              submitLabel="Save deal"
                            >
                              <input type="hidden" name="doctorId" value={d.id} />
                              <div>
                                <Label htmlFor={`dt-${d.id}`}>Deal type</Label>
                                <Select id={`dt-${d.id}`} name="dealType" defaultValue={d.dealType}>
                                  {DEAL_TYPES.map((t) => <option key={t} value={t}>{DEAL_TYPE_LABELS[t]}</option>)}
                                </Select>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <Label htmlFor={`df-${d.id}`}>Fixed amount</Label>
                                  <Input id={`df-${d.id}`} name="fixedAmount" type="number" min={0} step="1000" defaultValue={d.fixedAmount ?? ""} />
                                </div>
                                <div>
                                  <Label htmlFor={`dp-${d.id}`}>Percent</Label>
                                  <Input id={`dp-${d.id}`} name="percent" type="number" min={0} max={100} step="0.5" defaultValue={d.percent ?? ""} />
                                </div>
                              </div>
                              <div>
                                <Label htmlFor={`dc2-${d.id}`}>Contract status</Label>
                                <Select id={`dc2-${d.id}`} name="contractStatus" defaultValue={d.contractStatus}>
                                  <option value="ACTIVE">Active</option>
                                  <option value="SUSPENDED">Suspended</option>
                                  <option value="ENDED">Ended</option>
                                </Select>
                              </div>
                              <div>
                                <Label htmlFor={`dr2-${d.id}`} required>Reason</Label>
                                <Textarea id={`dr2-${d.id}`} name="reason" required />
                              </div>
                            </ActionDialog>
                            {outstanding > 0 && (
                              <ActionDialog
                                trigger="Pay"
                                triggerSize="sm"
                                triggerVariant="primary"
                                title={`Pay commissions — Dr. ${d.name}`}
                                description={`Outstanding: ${fmtIQD(outstanding)}. Posts an approved professional-fees expense.`}
                                action={recordDoctorPayment}
                                submitLabel="Record payment"
                              >
                                <input type="hidden" name="referralDoctorId" value={d.id} />
                                <div>
                                  <Label htmlFor={`pa3-${d.id}`} required>Amount (IQD)</Label>
                                  <Input id={`pa3-${d.id}`} name="amount" type="number" min={1} step="1000" defaultValue={outstanding} required />
                                </div>
                                <div>
                                  <Label htmlFor={`pm3-${d.id}`}>Method</Label>
                                  <Select id={`pm3-${d.id}`} name="method" defaultValue="CASH">
                                    <option value="CASH">Cash</option>
                                    <option value="CARD">Card</option>
                                    <option value="TRANSFER">Bank transfer</option>
                                  </Select>
                                </div>
                              </ActionDialog>
                            )}
                          </span>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        </Card>
      )}
    </>
  );
}
