import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileOutput, Rocket, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { maybeRunAlertScan } from "@/lib/analytics/alerts";
import {
  attendanceStats, branchOverviews, financeSummary, revenueExpenseTrend, visitStats, visitTrend,
} from "@/lib/analytics/metrics";
import { detectBottlenecks } from "@/lib/ai/bottlenecks";
import { LocalMernaAIProvider, applyAnswerMasking } from "@/lib/ai/local-provider";
import {
  fmtDateTime, fmtDuration, fmtIQDCompact, fmtNumber, fmtPercent, pctChange, relativeTime,
} from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, ThSort, Tr, Td, TableEmpty } from "@/components/ui/table";
import { TrendLines } from "@/components/ui/charts";
import { FunnelSteps, HBarList, HeatGrid, ScoreRing } from "@/components/ui/viz";
import { DEPARTMENT_TYPE_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Executive Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; denied?: string }>;
}) {
  const user = await requireUser("dashboard");
  const scope = await getScope(user);
  const sp = await searchParams;

  // Keep the alert engine fresh (throttled internally).
  await maybeRunAlertScan();

  const range = { from: scope.from, to: scope.to };
  const prevRange = { from: scope.prevFrom, to: scope.prevTo };

  const [fin, prevFin, ops, prevOps, att, prevAtt, rows, trend, visitsTrend, bottlenecks, criticalAlerts, incidents, mgmtEvents, branchCount] =
    await Promise.all([
      financeSummary(scope.branchIds, range),
      financeSummary(scope.branchIds, prevRange),
      visitStats(scope.branchIds, range),
      visitStats(scope.branchIds, prevRange),
      attendanceStats(scope.branchIds, range),
      attendanceStats(scope.branchIds, prevRange),
      branchOverviews(scope.branchIds, range),
      revenueExpenseTrend(scope.branchIds, range),
      visitTrend(scope.branchIds, range),
      detectBottlenecks(scope.branchIds, range, prevRange),
      db.alert.findMany({
        where: { severity: "CRITICAL", status: { not: "RESOLVED" }, OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }] },
        orderBy: { detectedAt: "desc" },
        take: 5,
      }),
      db.incident.findMany({
        where: { status: { notIn: ["CLOSED"] }, OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }] },
        orderBy: { detectedAt: "desc" },
        take: 5,
        include: { branch: { select: { name: true } } },
      }),
      db.auditEvent.findMany({
        where: { riskLevel: { in: ["MEDIUM", "HIGH"] }, OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }] },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.branch.count(),
    ]);

  // First-run guidance: nothing exists yet.
  if (branchCount === 0) {
    return (
      <>
        <PageHeader
          title="Executive Dashboard"
          subtitle="Welcome to Merna Control Center — the management panel is live and empty, ready for real data."
        />
        <EmptyState
          icon={<Rocket size={18} strokeWidth={1.5} />}
          title="Set up your first branch"
          description="Create a branch, add its departments and services, register employees and start operating. Every module fills with live data as the organization works."
          action={
            <Link href="/branches" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-medium text-on-primary hover:bg-black">
              Create the first branch <ArrowRight size={14} />
            </Link>
          }
        />
        <ol className="mx-auto mt-6 max-w-md space-y-2 text-[13px] text-body">
          {[
            ["1", "Create branches", "/branches"],
            ["2", "Add departments, machines and services", "/departments"],
            ["3", "Register employees and issue agreements", "/employees"],
            ["4", "Add user accounts for your team", "/settings?tab=users"],
            ["5", "Start operating queues and finances", "/queues"],
          ].map(([n, label, href]) => (
            <li key={n} className="flex items-center gap-3 rounded-md bg-canvas px-3 py-2 shadow-card">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary">{n}</span>
              <Link href={href} className="hover:underline">{label}</Link>
            </li>
          ))}
        </ol>
      </>
    );
  }

  // AI executive summary (deterministic, role-masked)
  const provider = new LocalMernaAIProvider();
  const aiSummary = applyAnswerMasking(
    await provider.answer({
      question: "executive briefing",
      userRole: user.role,
      branchIds: scope.branchIds,
      branchName: scope.branchName,
      range,
      prevRange,
    }),
    user.role,
  );

  // Branch health matrix sorting (weakest metric first by default)
  const sort = sp.sort ?? "health";
  const sortedRows = [...rows].sort((a, b) => {
    switch (sort) {
      case "revenue": return a.revenue - b.revenue;
      case "attendance": return (a.attendanceRate ?? 101) - (b.attendanceRate ?? 101);
      case "wait": return (b.avgWait ?? -1) - (a.avgWait ?? -1);
      case "backlog": return b.reportBacklog - a.reportBacklog;
      case "waste": return (b.wasteRate ?? -1) - (a.wasteRate ?? -1);
      default: return (a.health.total ?? 101) - (b.health.total ?? 101);
    }
  });

  // Department pressure heat map (branch × dept type utilization)
  const departments = await db.department.findMany({
    where: { branchId: { in: scope.branchIds }, status: "ACTIVE" },
    select: {
      id: true, type: true, dailyCapacity: true, branchId: true,
      _count: { select: { visits: { where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } } } } },
    },
  });
  const heatTypes = [...new Set(departments.map((d) => d.type))];
  const heatCells = rows.map((r) =>
    heatTypes.map((t) => {
      const deps = departments.filter((d) => d.branchId === r.id && d.type === t);
      if (!deps.length) return 0;
      const load = deps.reduce((s, d) => s + d._count.visits / Math.max(1, d.dailyCapacity / 4), 0) / deps.length;
      return Math.min(1, load);
    }),
  );

  // What needs attention: bottlenecks + critical alerts, ranked
  const attention = [
    ...criticalAlerts.map((a) => ({
      severity: "CRITICAL" as const,
      title: a.title,
      detail: a.description,
      href: "/alerts",
      kind: "Alert",
    })),
    ...bottlenecks.map((b) => ({
      severity: b.severity,
      title: `${b.branchName}${b.departmentName ? ` — ${b.departmentName}` : ""}: ${b.metric} ${b.value}`,
      detail: `${b.likelyCause} ${b.impact} Suggested: ${b.action}`,
      href: b.link,
      kind: b.category.toLowerCase(),
    })),
  ].slice(0, 7);

  const makeSortHref = (s: string) => `/dashboard?sort=${s}`;
  const now = new Date();

  return (
    <>
      {sp.denied && (
        <p role="alert" className="mb-4 rounded-md border border-warning-soft bg-warning-soft/40 px-3 py-2 text-[13px] text-warning-deep">
          Your role does not have access to that module — you were redirected to the dashboard.
        </p>
      )}
      <PageHeader
        title="Merna Control Center"
        subtitle={`${scope.branchName ?? "All branches"} · ${range.from.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${range.to.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · refreshed ${fmtDateTime(now)}`}
        actions={
          <>
            <Link
              href="/reports?type=EXECUTIVE_SUMMARY"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] font-medium text-body hover:border-hairline-strong hover:text-ink"
            >
              <FileOutput size={13} /> Executive report
            </Link>
            <Link
              href="/merna-ai?prompt=Give%20me%20today%27s%20executive%20briefing."
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ai px-2.5 text-[13px] font-medium text-white hover:bg-violet-deep"
            >
              <Sparkles size={13} /> Ask Merna AI
            </Link>
          </>
        }
      />

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Total revenue" value={fmtIQDCompact(fin.revenue)} delta={pctChange(fin.revenue, prevFin.revenue)}
          spark={trend.map((t) => t.revenue as number)} definition="Sum of income entries received in the period." href="/finance/income" />
        <KpiCard label="Total expenses" value={fmtIQDCompact(fin.expenses)} delta={pctChange(fin.expenses, prevFin.expenses)} invertDelta
          spark={trend.map((t) => t.expenses as number)} definition="Approved expenses dated in the period." href="/finance/expenses" />
        <KpiCard label="Net result" value={fmtIQDCompact(fin.net)} delta={pctChange(fin.net, prevFin.net)}
          tone={fin.net < 0 ? "critical" : undefined} definition="Revenue minus approved expenses." href="/finance" />
        <KpiCard label="Patient visits" value={fmtNumber(ops.total)} delta={pctChange(ops.total, prevOps.total)}
          spark={visitsTrend.map((t) => t.visits as number)} definition="Visits registered in the period." href="/patients" />
        <KpiCard label="Active employees" value={fmtNumber(att.activeEmployees)} definition="Employees with Active status in scope." href="/employees" />
        <KpiCard label="Attendance rate" value={att.rate !== null ? fmtPercent(att.rate) : "—"}
          delta={att.rate !== null && prevAtt.rate !== null ? att.rate - prevAtt.rate : null}
          definition="(Present + late) ÷ scheduled working records. Employee-weighted across branches." href="/attendance" />
        <KpiCard label="Open critical alerts" value={fmtNumber(criticalAlerts.length)}
          tone={criticalAlerts.length > 0 ? "critical" : undefined} definition="Unresolved critical alerts in scope." href="/alerts" />
        <KpiCard label="Branches needing attention" value={fmtNumber(rows.filter((r) => (r.health.total ?? 100) < 75 || r.criticalAlerts > 0).length)}
          tone={rows.some((r) => (r.health.total ?? 100) < 75) ? "warning" : undefined}
          definition="Health score below 75 or carrying critical alerts." href="/branches?health=attention" />
      </div>

      {/* Attention + AI summary */}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="What needs attention"
            subtitle="Ranked from unresolved critical alerts and the live bottleneck engine"
            actions={<Link href="/alerts" className="text-[12px] font-medium text-link hover:underline">All alerts</Link>}
          />
          <CardBody className="space-y-2">
            {attention.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-good-deep">
                Nothing needs attention — all monitored thresholds are healthy.
              </p>
            ) : (
              attention.map((a, i) => (
                <details key={i} className="group rounded-md border border-hairline">
                  <summary className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                    <span className="font-mono text-[11px] text-mute">{i + 1}</span>
                    <Badge tone={a.severity === "CRITICAL" ? "critical" : "warning"} dot>{a.severity.toLowerCase()}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{a.title}</span>
                    <Badge tone="neutral">{a.kind}</Badge>
                  </summary>
                  <div className="border-t border-hairline px-3 py-2.5">
                    <p className="text-[12.5px] leading-relaxed text-body">{a.detail}</p>
                    <div className="mt-2 flex gap-3">
                      <Link href={a.href} className="text-[12px] font-medium text-link hover:underline">Open details →</Link>
                      <Link
                        href={`/merna-ai?prompt=${encodeURIComponent(`Explain and advise: ${a.title}`)}`}
                        className="text-[12px] font-medium text-violet-deep hover:underline"
                      >
                        Ask Merna AI
                      </Link>
                    </div>
                  </div>
                </details>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Merna AI executive summary"
            subtitle="Deterministic analysis of the current scope"
            actions={<Sparkles size={14} className="text-violet-deep" />}
          />
          <CardBody>
            <p className="text-[13px] leading-relaxed text-ink">{aiSummary.direct}</p>
            {aiSummary.findings.length > 0 && (
              <ul className="mt-2.5 space-y-1 border-t border-hairline pt-2.5">
                {aiSummary.findings.slice(0, 4).map((f, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-body">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ai" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/merna-ai?prompt=Give%20me%20today%27s%20executive%20briefing."
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-violet-deep hover:underline"
            >
              Continue with Merna AI <ArrowRight size={12} />
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* Branch health matrix */}
      <Card className="mb-4">
        <CardHeader
          title="Branch health matrix"
          subtitle="Sortable — click a column to rank by the weakest metric"
          actions={<Link href="/branches" className="text-[12px] font-medium text-link hover:underline">Branch directory</Link>}
        />
        <TableShell className="rounded-t-none shadow-none" dense>
          <THead>
            <Th>Branch</Th>
            <ThSort label="Health" sortKey="health" currentSort={sort} currentDir="asc" makeHref={makeSortHref} align="center" />
            <ThSort label="Revenue" sortKey="revenue" currentSort={sort} currentDir="asc" makeHref={makeSortHref} align="right" />
            <Th align="right">Net</Th>
            <ThSort label="Attendance" sortKey="attendance" currentSort={sort} currentDir="asc" makeHref={makeSortHref} align="right" />
            <ThSort label="Avg wait" sortKey="wait" currentSort={sort} currentDir="asc" makeHref={makeSortHref} align="right" />
            <ThSort label="Backlog" sortKey="backlog" currentSort={sort} currentDir="asc" makeHref={makeSortHref} align="right" />
            <ThSort label="Waste" sortKey="waste" currentSort={sort} currentDir="asc" makeHref={makeSortHref} align="right" />
            <Th align="right">Compliance</Th>
            <Th align="right">Security</Th>
            <Th align="right">Alerts</Th>
          </THead>
          <tbody>
            {sortedRows.length === 0 && <TableEmpty colSpan={11}>No branches in scope.</TableEmpty>}
            {sortedRows.map((r) => {
              const comp = r.health.components.find((c) => c.key === "compliance");
              const sec = r.health.components.find((c) => c.key === "security");
              return (
                <Tr key={r.id} highlight={(r.health.total ?? 100) < 60 || r.criticalAlerts > 0}>
                  <Td>
                    <Link href={`/branches/${r.id}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                    <span className="block text-[10.5px] text-mute">{r.city}</span>
                  </Td>
                  <Td align="center">
                    {r.health.total !== null ? <ScoreRing score={r.health.total} size={38} /> : <span className="text-mute">—</span>}
                  </Td>
                  <Td align="right">{fmtIQDCompact(r.revenue)}</Td>
                  <Td align="right" className={r.net < 0 ? "text-critical-deep" : undefined}>{fmtIQDCompact(r.net)}</Td>
                  <Td align="right">{r.attendanceRate !== null ? fmtPercent(r.attendanceRate) : "—"}</Td>
                  <Td align="right">{r.avgWait !== null ? fmtDuration(r.avgWait) : "—"}</Td>
                  <Td align="right">{fmtNumber(r.reportBacklog)}</Td>
                  <Td align="right">{r.wasteRate !== null ? fmtPercent(r.wasteRate) : "—"}</Td>
                  <Td align="right">{comp?.score !== null && comp !== undefined ? Math.round(comp.score) : "—"}</Td>
                  <Td align="right">{sec?.score !== null && sec !== undefined ? Math.round(sec.score) : "—"}</Td>
                  <Td align="right">{r.criticalAlerts > 0 ? <Badge tone="critical">{r.criticalAlerts}</Badge> : <span className="text-mute">0</span>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>

      {/* Charts row */}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Revenue vs expenses vs net" subtitle="Daily buckets in the selected period" />
          <CardBody>
            {trend.some((t) => (t.revenue as number) > 0 || (t.expenses as number) > 0) ? (
              <TrendLines
                data={trend}
                money
                series={[
                  { key: "revenue", label: "Revenue", color: "#171717" },
                  { key: "expenses", label: "Expenses", color: "#a1a1a1" },
                  { key: "net", label: "Net", color: "#0070f3" },
                ]}
              />
            ) : (
              <p className="py-10 text-center text-[13px] text-mute">No financial activity in this period yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Branch contribution" subtitle="Net result by branch" />
          <CardBody>
            {rows.length ? (
              <HBarList money items={rows.sort((a, b) => b.net - a.net).map((r) => ({ label: r.name, value: r.net }))} />
            ) : (
              <p className="py-10 text-center text-[13px] text-mute">No branches.</p>
            )}
            <div className="mt-4 border-t border-hairline pt-3">
              <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Shareholder-ready summary</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[15px] font-semibold tabular-nums text-ink">{fmtIQDCompact(fin.revenue)}</p><p className="text-[10.5px] text-mute">Group revenue</p></div>
                <div><p className="text-[15px] font-semibold tabular-nums text-ink">{fmtIQDCompact(fin.expenses)}</p><p className="text-[10.5px] text-mute">Group expenses</p></div>
                <div><p className="text-[15px] font-semibold tabular-nums text-ink">{fmtIQDCompact(fin.net)}</p><p className="text-[10.5px] text-mute">Net result</p></div>
              </div>
              <Link href="/governance/shareholders" className="mt-2 inline-block text-[12px] font-medium text-link hover:underline">
                Shareholder panel →
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Flow + pressure + activity */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Patient flow" subtitle="Funnel across the visit lifecycle" />
          <CardBody>
            {ops.total > 0 ? (
              <FunnelSteps steps={ops.funnel} />
            ) : (
              <p className="py-8 text-center text-[13px] text-mute">No visits in this period.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Department pressure map" subtitle="Live queue load vs capacity" />
          <CardBody>
            {heatTypes.length && rows.length ? (
              <HeatGrid
                rows={rows.map((r) => r.name)}
                cols={heatTypes.map((t) => DEPARTMENT_TYPE_LABELS[t as keyof typeof DEPARTMENT_TYPE_LABELS] ?? t)}
                cells={heatCells}
                legend="Darker = heavier live queue load"
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-mute">No active departments.</p>
            )}
            <Link href="/live" className="mt-2 inline-block text-[12px] font-medium text-link hover:underline">
              Live operations board →
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Management activity & risks"
            actions={<Link href="/management-activities" className="text-[12px] font-medium text-link hover:underline">All activity</Link>}
          />
          <CardBody>
            {mgmtEvents.length === 0 && incidents.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-mute">No recent management activity or open incidents.</p>
            ) : (
              <div className="space-y-3">
                {incidents.length > 0 && (
                  <div>
                    <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Open incidents</p>
                    <ul className="space-y-1.5">
                      {incidents.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                          <Link href={`/incidents/${i.id}`} className="min-w-0 truncate text-body hover:text-ink hover:underline">{i.title}</Link>
                          <Badge tone={statusTone(i.status)}>{i.status.toLowerCase()}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Recent management actions</p>
                  <ul className="space-y-1.5">
                    {mgmtEvents.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate text-body">
                          <span className="font-mono">{e.action}</span> · {e.userName}
                        </span>
                        <span className="shrink-0 text-[11px] text-mute">{relativeTime(e.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
