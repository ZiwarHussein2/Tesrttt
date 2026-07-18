import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { canWrite, maskingFor } from "@/lib/permissions";
import { attendanceStats } from "@/lib/analytics/metrics";
import { fmtDate, fmtDuration, fmtNumber, fmtPercent, fmtTime, maskName } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { Toolbar, SearchInput, FilterSelect } from "@/components/ui/toolbar";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/components/ui/export-button";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, LOCATION_STATUS_LABELS,
} from "@/types/enums";
import { correctAttendance, reviewAttendanceException } from "./actions";

export const metadata: Metadata = { title: "Attendance" };

const PAGE_SIZE = 30;

type Search = { q?: string; status?: string; branch?: string; exception?: string; page?: string };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser("attendance");
  const scope = await getScope(user);
  const sp = await searchParams;
  const masking = maskingFor(user.role);
  const writable = canWrite(user.role, "attendance");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [stats, todayPresent, todayAbsent, todayLate, todayCheckedOut, onLeave, geoExceptions, deviceExceptions] =
    await Promise.all([
      attendanceStats(scope.branchIds, scope),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: todayStart }, status: { in: ["PRESENT", "LATE"] } } }),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: todayStart }, status: "ABSENT" } }),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: todayStart }, status: "LATE" } }),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: todayStart }, checkOut: { not: null } } }),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: todayStart }, status: "LEAVE" } }),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: scope.from }, locationStatus: { in: ["OUTSIDE_ZONE", "REVIEW"] } } }),
      db.attendanceRecord.count({ where: { branchId: { in: scope.branchIds }, date: { gte: scope.from }, deviceMatch: "MISMATCH" } }),
    ]);

  const where = {
    branchId: { in: scope.branchIds },
    date: { gte: scope.from, lt: scope.to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.exception === "yes" ? { exception: true } : {}),
    ...(sp.exception === "pending" ? { exception: true, reviewStatus: "PENDING" } : {}),
    ...(sp.q
      ? { employee: { OR: [{ firstName: { contains: sp.q } }, { lastName: { contains: sp.q } }, { employeeCode: { contains: sp.q } }] } }
      : {}),
  };

  const page = Math.max(1, Number(sp.page) || 1);
  const [total, records, branches] = await Promise.all([
    db.attendanceRecord.count({ where }),
    db.attendanceRecord.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } },
        branch: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.branch.findMany({ where: { id: { in: scope.branchIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
    params.set("page", String(p));
    return `/attendance?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Daily presence, lateness, overtime and monitoring exceptions. Every correction preserves the original values as legal evidence."
        actions={<ExportCsvButton filename="merna-attendance.csv" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Present today" value={fmtNumber(todayPresent)} definition="Records with status Present or Late today." />
        <KpiCard label="Absent today" value={fmtNumber(todayAbsent)} tone={todayAbsent > 0 ? "warning" : undefined} />
        <KpiCard label="Late today" value={fmtNumber(todayLate)} />
        <KpiCard label="Checked out" value={fmtNumber(todayCheckedOut)} />
        <KpiCard label="On leave" value={fmtNumber(onLeave)} />
        <KpiCard label="Attendance rate (period)" value={stats.rate !== null ? fmtPercent(stats.rate) : "—"} definition="(Present + late) ÷ scheduled working records." />
        <KpiCard label="Overtime (period)" value={fmtDuration(stats.totalOvertimeMinutes)} />
        <KpiCard label="Missing checkout" value={fmtNumber(stats.missingCheckout)} tone={stats.missingCheckout > 0 ? "warning" : undefined} />
        <KpiCard label="Location exceptions" value={fmtNumber(geoExceptions)} tone={geoExceptions > 0 ? "warning" : undefined} definition="Outside approved zone or manual review — precise coordinates are never shown." />
        <KpiCard label="Device exceptions" value={fmtNumber(deviceExceptions)} tone={deviceExceptions > 0 ? "warning" : undefined} />
      </div>

      {stats.records === 0 && total === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={18} strokeWidth={1.5} />}
          title="No attendance records in this period"
          description="Attendance is recorded per employee per day — from an employee page (Attendance tab → Record day) or via the future branch-system integration."
          action={<Link href="/employees" className="text-[13px] font-medium text-link hover:underline">Go to employees</Link>}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput placeholder="Search employee…" className="w-full sm:w-56" />
            <FilterSelect param="status" label="Status" allLabel="All statuses" options={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: ATTENDANCE_STATUS_LABELS[s] }))} />
            {branches.length > 1 && (
              <FilterSelect param="branch" label="Branch" allLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            )}
            <FilterSelect
              param="exception"
              label="Exceptions"
              allLabel="All records"
              options={[
                { value: "yes", label: "Exceptions only" },
                { value: "pending", label: "Pending review" },
              ]}
            />
          </Toolbar>

          <div id="export-region">
            <TableShell dense>
              <THead>
                <Th>Employee</Th><Th>Branch</Th><Th>Date</Th><Th>Status</Th>
                <Th align="right">Scheduled</Th><Th align="right">In</Th><Th align="right">Out</Th>
                <Th align="right">Late</Th><Th align="right">OT</Th>
                <Th>Device</Th><Th>Location</Th><Th>Review</Th>
                {writable && <Th align="right">Actions</Th>}
              </THead>
              <tbody>
                {records.length === 0 && <TableEmpty colSpan={writable ? 13 : 12}>No records match the current filters.</TableEmpty>}
                {records.map((r) => (
                  <Tr key={r.id} highlight={r.exception && r.reviewStatus === "PENDING"}>
                    <Td>
                      <Link href={`/employees/${r.employee.id}?tab=attendance`} className="font-medium text-ink hover:underline">
                        {masking.employeeContact ? maskName(r.employee.firstName, r.employee.lastName) : `${r.employee.firstName} ${r.employee.lastName}`}
                      </Link>
                      <span className="block text-[10.5px] text-mute">{r.employee.department?.name ?? "—"}</span>
                    </Td>
                    <Td>{r.branch.name}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.date)}</Td>
                    <Td><Badge tone={statusTone(r.status)} dot>{ATTENDANCE_STATUS_LABELS[r.status as keyof typeof ATTENDANCE_STATUS_LABELS]}</Badge></Td>
                    <Td align="right" className="text-mute">{r.scheduledStart}–{r.scheduledEnd}</Td>
                    <Td align="right">{fmtTime(r.checkIn)}</Td>
                    <Td align="right">{fmtTime(r.checkOut)}</Td>
                    <Td align="right">{r.lateMinutes > 0 ? `${r.lateMinutes}m` : "—"}</Td>
                    <Td align="right">{r.overtimeMinutes > 0 ? fmtDuration(r.overtimeMinutes) : "—"}</Td>
                    <Td><Badge tone={statusTone(r.deviceMatch)}>{r.deviceMatch.toLowerCase()}</Badge></Td>
                    <Td className="max-w-40 truncate text-[11.5px]">{LOCATION_STATUS_LABELS[r.locationStatus as keyof typeof LOCATION_STATUS_LABELS] ?? r.locationStatus}</Td>
                    <Td>
                      {r.correctionReason ? (
                        <Badge tone="warning">Corrected</Badge>
                      ) : r.exception ? (
                        <Badge tone={r.reviewStatus === "PENDING" ? "critical" : "neutral"}>
                          {r.reviewStatus === "PENDING" ? "Pending" : "Reviewed"}
                        </Badge>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </Td>
                    {writable && (
                      <Td align="right">
                        <span className="flex justify-end gap-1.5">
                          {r.exception && r.reviewStatus === "PENDING" && (
                            <ActionDialog
                              trigger="Review"
                              triggerSize="sm"
                              title="Review exception"
                              description={`${r.exceptionType?.replace(/_/g, " ").toLowerCase() ?? "Exception"} — add the review outcome.`}
                              action={reviewAttendanceException}
                              submitLabel="Mark reviewed"
                            >
                              <input type="hidden" name="recordId" value={r.id} />
                              <div>
                                <Label htmlFor={`rn-${r.id}`} required>Review note</Label>
                                <Textarea id={`rn-${r.id}`} name="reason" required placeholder="Outcome of the review…" />
                              </div>
                            </ActionDialog>
                          )}
                          <ActionDialog
                            trigger="Correct"
                            triggerSize="sm"
                            title={`Correct record — ${fmtDate(r.date)}`}
                            description="Original values stay in the audit log with your reason, name and timestamp."
                            action={correctAttendance}
                            submitLabel="Apply correction"
                          >
                            <input type="hidden" name="recordId" value={r.id} />
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label htmlFor={`gci-${r.id}`}>Check-in (HH:MM)</Label>
                                <Input id={`gci-${r.id}`} name="checkIn" defaultValue={r.checkIn ? fmtTime(r.checkIn) : ""} />
                              </div>
                              <div>
                                <Label htmlFor={`gco-${r.id}`}>Check-out (HH:MM)</Label>
                                <Input id={`gco-${r.id}`} name="checkOut" defaultValue={r.checkOut ? fmtTime(r.checkOut) : ""} />
                              </div>
                            </div>
                            <div>
                              <Label htmlFor={`gcs-${r.id}`}>Or mark day as</Label>
                              <Select id={`gcs-${r.id}`} name="status" defaultValue="">
                                <option value="">— Derived from times —</option>
                                <option value="ABSENT">Absent</option>
                                <option value="LEAVE">On leave</option>
                                <option value="HOLIDAY">Holiday</option>
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor={`gcr-${r.id}`} required>Correction reason</Label>
                              <Textarea id={`gcr-${r.id}`} name="reason" required />
                            </div>
                          </ActionDialog>
                        </span>
                      </Td>
                    )}
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
