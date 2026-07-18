import type { Metadata } from "next";
import Link from "next/link";
import { FileOutput, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, isBranchScoped } from "@/lib/permissions";
import { relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import { ActionButton } from "@/components/ui/dialog";
import { REPORT_TYPES, REPORT_TYPE_LABELS, type ReportType } from "@/types/enums";
import { deleteSavedReport } from "./actions";

export const metadata: Metadata = { title: "Report Builder" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; saved?: string }>;
}) {
  const user = await requireUser("reports");
  const scope = await getScope(user);
  const sp = await searchParams;
  const writable = canWrite(user.role, "reports");

  const branches = await db.branch.findMany({
    where: { id: { in: scope.branchIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const saved = await db.savedReport.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });

  // Prefill from a saved configuration
  let prefill: { type?: string; title?: string; branch?: string; preparedFor?: string; confidentiality?: string } = {};
  if (sp.saved) {
    const s = saved.find((x) => x.id === sp.saved) ?? await db.savedReport.findFirst({ where: { id: sp.saved, userId: user.id } });
    if (s) {
      try { prefill = JSON.parse(s.params) as typeof prefill; } catch { /* ignore */ }
    }
  }
  const selectedType = (sp.type && REPORT_TYPES.includes(sp.type as ReportType) ? sp.type : prefill.type) ?? "EXECUTIVE_SUMMARY";

  return (
    <>
      <PageHeader
        title="Report Builder"
        subtitle="Formal PDF reports generated client-side from live data — with confidentiality labels, data definitions and page numbering."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Build a report" subtitle="The document is assembled from the same figures as the dashboards" />
          <CardBody>
            <form action="/reports/view" method="GET" className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="rb-type" required>Report type</Label>
                  <Select id="rb-type" name="type" defaultValue={selectedType}>
                    {REPORT_TYPES.map((t) => (
                      <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rb-title" required>Title</Label>
                  <Input id="rb-title" name="title" defaultValue={prefill.title ?? ""} placeholder="e.g. Weekly Executive Report" required />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="rb-branch">Branch scope</Label>
                  <Select id="rb-branch" name="branch" defaultValue={prefill.branch ?? (scope.branchId ?? "ALL")} disabled={isBranchScoped(user.role)}>
                    {!isBranchScoped(user.role) && <option value="ALL">All branches</option>}
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rb-from">From</Label>
                  <Input id="rb-from" name="from" type="date" defaultValue={scope.from.toISOString().slice(0, 10)} />
                </div>
                <div>
                  <Label htmlFor="rb-to">To</Label>
                  <Input id="rb-to" name="to" type="date" defaultValue={scope.to.toISOString().slice(0, 10)} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="rb-for">Prepared for</Label>
                  <Input id="rb-for" name="preparedFor" defaultValue={prefill.preparedFor ?? "Merna Medical Company management"} />
                </div>
                <div>
                  <Label htmlFor="rb-conf">Confidentiality label</Label>
                  <Select id="rb-conf" name="confidentiality" defaultValue={prefill.confidentiality ?? "Confidential"}>
                    <option value="Confidential">Confidential</option>
                    <option value="Highly Confidential">Highly Confidential</option>
                    <option value="Internal">Internal</option>
                    <option value="Board Only">Board Only</option>
                  </Select>
                </div>
              </div>
              <Hint>
                The generated document includes the executive summary, KPI tables, findings from the bottleneck engine,
                recommended actions and data definitions relevant to the chosen type.
              </Hint>
              <div className="flex justify-end border-t border-hairline pt-4">
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-medium text-on-primary hover:bg-primary/85"
                >
                  <FileOutput size={14} />
                  Generate report
                </button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Saved reports" subtitle="Your report library" />
          <CardBody>
            {saved.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-mute">
                Saved report configurations and AI insights appear here.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {saved.map((s) => {
                  let convoId: string | null = null;
                  if (s.type === "CUSTOM_AI") {
                    try { convoId = (JSON.parse(s.params) as { conversationId?: string }).conversationId ?? null; } catch { /* ignore */ }
                  }
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                      <div className="min-w-0">
                        <Link
                          href={convoId ? `/merna-ai?c=${convoId}` : `/reports?saved=${s.id}`}
                          className="block truncate text-[13px] font-medium text-ink hover:underline"
                        >
                          {s.title}
                        </Link>
                        <p className="text-[10.5px] text-mute">
                          {REPORT_TYPE_LABELS[s.type as ReportType] ?? s.type} · {relativeTime(s.updatedAt)}
                        </p>
                      </div>
                      {writable && (
                        <ActionButton
                          label={<Trash2 size={12} />}
                          variant="ghost"
                          size="sm"
                          action={deleteSavedReport}
                          confirmTitle={`Delete “${s.title}”?`}
                          hidden={{ savedId: s.id }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
