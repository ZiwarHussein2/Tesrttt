import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, getSessionUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { logAudit } from "@/lib/audit";
import { isBranchScoped } from "@/lib/permissions";
import { buildReport } from "@/lib/reports/build";
import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { REPORT_TYPES, type ReportType } from "@/types/enums";
import { ReportPdfButton } from "../report-pdf-button";
import { saveReportConfig } from "../actions";

export const metadata: Metadata = { title: "Generated Report" };

type Search = {
  type?: string; title?: string; branch?: string; from?: string; to?: string;
  preparedFor?: string; confidentiality?: string;
};

export default async function ReportViewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("reports");
  const scope = await getScope(user);
  const sp = await searchParams;

  const type: ReportType = REPORT_TYPES.includes(sp.type as ReportType) ? (sp.type as ReportType) : "EXECUTIVE_SUMMARY";
  const title = (sp.title ?? "").trim() || "Merna Report";

  // Resolve range (defaults to global scope range)
  const from = sp.from ? new Date(sp.from) : scope.from;
  const toRaw = sp.to ? new Date(sp.to) : scope.to;
  const to = new Date(toRaw.getTime() + (sp.to ? 24 * 3600000 : 0)); // include the chosen end day
  const spanMs = Math.max(24 * 3600000, to.getTime() - from.getTime());
  const prevRange = { from: new Date(from.getTime() - spanMs), to: from };

  // Resolve branch scope (branch admins pinned)
  let branchIds = scope.branchIds;
  let scopeLabel = scope.branchName ?? "All branches";
  if (sp.branch && sp.branch !== "ALL" && !isBranchScoped(user.role)) {
    const branch = await db.branch.findUnique({ where: { id: sp.branch } });
    if (branch) {
      branchIds = [branch.id];
      scopeLabel = branch.name;
    }
  }

  const company = await db.company.findFirst({ select: { name: true } });

  const data = await buildReport({
    type,
    title,
    branchIds,
    scopeLabel,
    range: { from, to },
    prevRange,
    preparedFor: (sp.preparedFor ?? "").trim() || "Merna Medical Company management",
    confidentiality: (sp.confidentiality ?? "").trim() || "Confidential",
    companyName: company?.name ?? "Merna Medical Company",
  });

  // Report generation is a controlled export — audit it.
  const sessionUser = await getSessionUser();
  await logAudit(sessionUser, {
    action: "report.generate",
    resourceType: "Report",
    resourceLabel: `${data.reportType} — ${title}`,
    riskLevel: "LOW",
    reason: `Scope: ${scopeLabel}`,
  });

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="print:hidden">
        <PageHeader
          breadcrumbs={[{ label: "Report Builder", href: "/reports" }, { label: title }]}
          title={title}
          subtitle={`${data.reportType} · ${data.scope} · ${data.period}`}
          actions={
            <>
              <PrintButton />
              <ReportPdfButton data={data} />
              <ActionDialog
                trigger="Save to library"
                title="Save report configuration"
                description="Saves this configuration to your report library for repeat generation."
                action={saveReportConfig}
                submitLabel="Save"
              >
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="branch" value={sp.branch ?? "ALL"} />
                <input type="hidden" name="preparedFor" value={data.preparedFor} />
                <input type="hidden" name="confidentiality" value={data.confidentiality} />
                <div>
                  <Label htmlFor="sv-title" required>Title</Label>
                  <Input id="sv-title" name="title" defaultValue={title} required />
                </div>
              </ActionDialog>
            </>
          }
        />
      </div>

      {/* On-screen formal document */}
      <div className="rounded-lg bg-canvas p-8 shadow-card print:rounded-none print:p-0 print:shadow-none">
        <div className="border-b-2 border-primary pb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-mute">{data.confidentiality} — {data.companyName}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.8px] text-ink">{data.title}</h1>
          <p className="mt-1 text-[13px] text-body">{data.reportType} · {data.scope} · {data.period}</p>
          <p className="text-[12px] text-mute">Prepared for: {data.preparedFor}</p>
        </div>

        {data.sections.map((s, i) => (
          <section key={i} className="mt-6 print:break-inside-avoid-page">
            <h2 className="mb-2.5 text-[14px] font-semibold tracking-[-0.3px] text-ink">{s.heading}</h2>
            {s.kpis && (
              <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                {s.kpis.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10.5px] font-medium uppercase tracking-wide text-mute">{label}</dt>
                    <dd className="text-[14px] font-semibold tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {s.paragraphs?.map((para, j) => (
              <p key={j} className="mb-2 text-[13px] leading-relaxed text-body">{para}</p>
            ))}
            {s.bullets && (
              <ul className="mb-2 space-y-1">
                {s.bullets.map((b2, j) => (
                  <li key={j} className="flex gap-2 text-[12.5px] leading-relaxed text-body">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-hairline-strong" />
                    {b2}
                  </li>
                ))}
              </ul>
            )}
            {s.table && (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full min-w-max text-[12px]">
                  <thead>
                    <tr className="border-b border-primary text-left font-mono text-[9.5px] uppercase tracking-wider text-mute">
                      {s.table.columns.map((c) => <th key={c} className="py-1.5 pr-4">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.length === 0 && (
                      <tr><td colSpan={s.table.columns.length} className="py-3 text-center text-mute">No data in this period.</td></tr>
                    )}
                    {s.table.rows.map((r, j) => (
                      <tr key={j} className="border-b border-hairline last:border-0">
                        {r.map((cell, k) => <td key={k} className="py-1.5 pr-4 text-body">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        <div className="mt-8 border-t-2 border-primary pt-3 text-[11px] leading-relaxed text-mute">
          <p>
            {data.confidentiality} — Prepared for {data.preparedFor}. Generated by Merna Control Center on{" "}
            {new Date().toLocaleString("en-GB")}. Figures reconcile with the live dashboards at generation time.
          </p>
        </div>
      </div>

      <p className="mt-3 text-center text-[12px] text-mute print:hidden">
        <Link href="/reports" className="text-link hover:underline">← Back to Report Builder</Link>
      </p>
    </div>
  );
}
