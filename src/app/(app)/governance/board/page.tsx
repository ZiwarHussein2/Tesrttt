import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Presentation } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createBoardMeeting, updateBoardMeeting } from "../actions";

export const metadata: Metadata = { title: "Board Reports" };

export default async function BoardPage() {
  const user = await requireUser("board-reports");
  const writable = canWrite(user.role, "board-reports");

  const [meetings, savedBoardReports] = await Promise.all([
    db.boardMeeting.findMany({ orderBy: { scheduledAt: "desc" } }),
    db.savedReport.findMany({
      where: { type: "SHAREHOLDER_BOARD" },
      include: { user: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  const upcoming = meetings.filter((m) => m.status === "SCHEDULED" && m.scheduledAt > new Date());

  const addDialog = writable ? (
    <ActionDialog
      trigger={<><Plus size={14} /> Schedule meeting</>}
      triggerVariant="primary"
      title="Schedule board meeting"
      action={createBoardMeeting}
      submitLabel="Schedule"
    >
      <div>
        <Label htmlFor="bm-title" required>Title</Label>
        <Input id="bm-title" name="title" placeholder="Quarterly board meeting" required />
      </div>
      <div>
        <Label htmlFor="bm-date" required>Date & time</Label>
        <Input id="bm-date" name="scheduledAt" type="datetime-local" required />
      </div>
      <div>
        <Label htmlFor="bm-agenda">Agenda</Label>
        <Textarea id="bm-agenda" name="agenda" placeholder="Items for discussion…" />
      </div>
    </ActionDialog>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Board Reports"
        subtitle="Board meetings, minutes, resolutions and the approved report library for shareholder distribution."
        actions={addDialog}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Upcoming meetings" value={fmtNumber(upcoming.length)} />
        <KpiCard label="Meetings held" value={fmtNumber(meetings.filter((m) => m.status === "HELD").length)} />
        <KpiCard label="Approved reports" value={fmtNumber(savedBoardReports.length)} definition="Saved shareholder/board report configurations." />
        <KpiCard label="Report builder" value={<Link href="/reports?type=SHAREHOLDER_BOARD" className="text-sm text-link hover:underline">Open →</Link>} definition="Generate a formal shareholder/board PDF." />
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          icon={<Presentation size={18} strokeWidth={1.5} />}
          title="No board meetings yet"
          description="Schedule board meetings, then record minutes and resolutions after they are held."
          action={addDialog}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-3 xl:col-span-2">
            {meetings.map((m) => (
              <Card key={m.id}>
                <CardHeader
                  title={m.title}
                  subtitle={fmtDateTime(m.scheduledAt)}
                  actions={
                    <span className="flex items-center gap-2">
                      <Badge tone={statusTone(m.status)} dot>{m.status.toLowerCase()}</Badge>
                      {writable && (
                        <ActionDialog
                          trigger="Update"
                          triggerSize="sm"
                          title={`Update — ${m.title}`}
                          description="Record status, minutes and resolutions."
                          action={updateBoardMeeting}
                          submitLabel="Save"
                          wide
                        >
                          <input type="hidden" name="meetingId" value={m.id} />
                          <div>
                            <Label htmlFor={`bs-${m.id}`}>Status</Label>
                            <Select id={`bs-${m.id}`} name="status" defaultValue={m.status}>
                              <option value="SCHEDULED">Scheduled</option>
                              <option value="HELD">Held</option>
                              <option value="CANCELLED">Cancelled</option>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`ba-${m.id}`}>Agenda</Label>
                            <Textarea id={`ba-${m.id}`} name="agenda" defaultValue={m.agenda ?? ""} />
                          </div>
                          <div>
                            <Label htmlFor={`bmn-${m.id}`}>Minutes</Label>
                            <Textarea id={`bmn-${m.id}`} name="minutes" defaultValue={m.minutes ?? ""} className="min-h-[100px]" />
                          </div>
                          <div>
                            <Label htmlFor={`br-${m.id}`}>Resolutions</Label>
                            <Textarea id={`br-${m.id}`} name="resolutions" defaultValue={m.resolutions ?? ""} placeholder="One resolution per line" />
                          </div>
                        </ActionDialog>
                      )}
                    </span>
                  }
                />
                {(m.agenda || m.minutes || m.resolutions) && (
                  <CardBody className="space-y-3 text-[13px] leading-relaxed text-body">
                    {m.agenda && (
                      <div>
                        <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Agenda</p>
                        <p className="whitespace-pre-wrap">{m.agenda}</p>
                      </div>
                    )}
                    {m.minutes && (
                      <div>
                        <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Minutes</p>
                        <p className="whitespace-pre-wrap">{m.minutes}</p>
                      </div>
                    )}
                    {m.resolutions && (
                      <div>
                        <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">Resolutions</p>
                        <p className="whitespace-pre-wrap">{m.resolutions}</p>
                      </div>
                    )}
                  </CardBody>
                )}
              </Card>
            ))}
          </div>

          <Card className="h-fit">
            <CardHeader
              title="Approved report library"
              subtitle="Saved shareholder/board reports"
              actions={<Link href="/reports?type=SHAREHOLDER_BOARD" className="text-[12px] font-medium text-link hover:underline">New report</Link>}
            />
            <CardBody>
              {savedBoardReports.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-mute">
                  No saved board reports yet. Build one in the Report Builder and save it here.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {savedBoardReports.map((r) => (
                    <li key={r.id} className="border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                      <Link href={`/reports?saved=${r.id}`} className="text-[13px] font-medium text-ink hover:underline">{r.title}</Link>
                      <p className="text-[11.5px] text-mute">By {r.user.name} · {fmtDateTime(r.updatedAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 border-t border-hairline pt-3 text-[11.5px] leading-relaxed text-mute">
                Access to board documents is restricted by role and every view or download is recorded in the audit trail.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
