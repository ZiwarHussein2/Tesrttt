import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { fmtDuration, fmtNumber, fmtTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { DEPARTMENT_TYPE_LABELS, MACHINE_STATUS_LABELS } from "@/types/enums";

export const metadata: Metadata = { title: "Live Operations" };

export default async function LivePage() {
  const user = await requireUser("live");
  const scope = await getScope(user);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const departments = await db.department.findMany({
    where: { branchId: { in: scope.branchIds }, status: "ACTIVE" },
    include: {
      branch: { select: { id: true, name: true } },
      machines: { select: { name: true, status: true } },
      visits: {
        where: { status: { in: ["PAID", "WAITING", "CALLED", "IN_PROGRESS"] } },
        select: { id: true, status: true, priority: true, registeredAt: true, visitNumber: true },
        orderBy: { registeredAt: "asc" },
      },
    },
    orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
  });

  const [todayVisits, todayCompleted, backlogTotal] = await Promise.all([
    db.visit.count({ where: { branchId: { in: scope.branchIds }, registeredAt: { gte: todayStart } } }),
    db.visit.count({ where: { branchId: { in: scope.branchIds }, status: "COMPLETED", completedAt: { gte: todayStart } } }),
    db.visit.count({
      where: {
        branchId: { in: scope.branchIds },
        reportRequired: true,
        status: { in: ["SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_PENDING"] },
      },
    }),
  ]);

  const totalInQueue = departments.reduce((s, d) => s + d.visits.length, 0);
  const now = Date.now();

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Live Operations"
        subtitle="Real-time queue pressure across every department. Refreshes automatically every 30 seconds."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Patients in queues" value={fmtNumber(totalInQueue)} />
        <KpiCard label="Registered today" value={fmtNumber(todayVisits)} />
        <KpiCard label="Completed today" value={fmtNumber(todayCompleted)} />
        <KpiCard label="Report backlog" value={fmtNumber(backlogTotal)} tone={backlogTotal > 20 ? "warning" : undefined} />
      </div>

      {departments.length === 0 ? (
        <EmptyState
          icon={<Activity size={18} strokeWidth={1.5} />}
          title="No active departments"
          description="The live board shows queue pressure once branches and departments are created."
          action={<Link href="/branches" className="text-[13px] font-medium text-link hover:underline">Go to branches</Link>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const inProgress = d.visits.find((v) => v.status === "IN_PROGRESS");
            const waiting = d.visits.filter((v) => v.status !== "IN_PROGRESS");
            const oldestWaitMin = waiting.length
              ? (now - waiting[0].registeredAt.getTime()) / 60000
              : null;
            const pressure = waiting.length / Math.max(1, d.dailyCapacity / 8);
            const machineDown = d.machines.some((m) => m.status === "OFFLINE" || m.status === "MAINTENANCE");
            return (
              <Card key={d.id} className={pressure > 1 ? "ring-1 ring-warning" : undefined}>
                <CardHeader
                  title={<Link href={`/queues?department=${d.id}`} className="hover:underline">{d.name}</Link>}
                  subtitle={`${d.branch.name} · ${DEPARTMENT_TYPE_LABELS[d.type as keyof typeof DEPARTMENT_TYPE_LABELS] ?? d.type}`}
                  actions={
                    machineDown
                      ? <Badge tone="critical" dot>Machine issue</Badge>
                      : pressure > 1
                        ? <Badge tone="warning" dot>High pressure</Badge>
                        : <Badge tone="good" dot>Normal</Badge>
                  }
                />
                <CardBody className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold tabular-nums text-ink">{waiting.length}</p>
                      <p className="text-[10.5px] text-mute">Waiting</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums text-ink">
                        {oldestWaitMin !== null ? fmtDuration(oldestWaitMin) : "—"}
                      </p>
                      <p className="text-[10.5px] text-mute">Oldest wait</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums text-ink">{d.targetWaitMinutes}m</p>
                      <p className="text-[10.5px] text-mute">Target</p>
                    </div>
                  </div>
                  <div className="border-t border-hairline pt-2.5 text-[12px]">
                    <p className="text-mute">
                      Current:{" "}
                      {inProgress ? (
                        <span className="font-mono text-ink">{inProgress.visitNumber}</span>
                      ) : (
                        <span>idle</span>
                      )}
                      {inProgress && ` · started ${fmtTime(inProgress.registeredAt)}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.machines.map((m, i) => (
                        <Badge key={i} tone={statusTone(m.status)}>{m.name}: {MACHINE_STATUS_LABELS[m.status as keyof typeof MACHINE_STATUS_LABELS]}</Badge>
                      ))}
                      {d.machines.length === 0 && <span className="text-[11px] text-mute">No machines registered</span>}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
