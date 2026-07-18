import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CheckCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { markAllNotificationsRead } from "../shell-actions";

export const metadata: Metadata = { title: "Notifications" };

const CATEGORY_TONES: Record<string, "critical" | "warning" | "ok" | "ai" | "neutral"> = {
  CRITICAL_ALERT: "critical",
  EXPENSE_ANOMALY: "warning",
  ATTENDANCE: "warning",
  REPORT_DELAY: "warning",
  LOW_STOCK: "warning",
  WASTE: "warning",
  AGREEMENT: "ok",
  POLICY: "ok",
  SECURITY: "critical",
  PRIVACY: "critical",
  AI_INSIGHT: "ai",
  PDF_READY: "neutral",
  MANAGEMENT: "neutral",
};

export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`${unread} unread. Critical alerts, review queues and system events addressed to you.`}
        actions={
          unread > 0 ? (
            <form action={markAllNotificationsRead}>
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] font-medium text-body hover:border-hairline-strong hover:text-ink"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            </form>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={<BellOff size={18} strokeWidth={1.5} />}
          title="No notifications"
          description="You are all caught up. Critical alerts and assigned reviews will appear here."
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={cn(
                "rounded-lg bg-canvas p-3.5 shadow-card",
                !n.readAt && "border-l-2 border-l-primary",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CATEGORY_TONES[n.category] ?? "neutral"} dot>
                  {n.category.replace(/_/g, " ").toLowerCase()}
                </Badge>
                <p className={cn("min-w-0 flex-1 truncate text-[13px]", n.readAt ? "text-body" : "font-medium text-ink")}>
                  {n.title}
                </p>
                <span className="text-[11.5px] text-mute" title={fmtDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</span>
              </div>
              {n.body && <p className="mt-1 text-[12.5px] leading-relaxed text-body">{n.body}</p>}
              {n.link && (
                <Link href={n.link} className="mt-1 inline-block text-[12.5px] font-medium text-link hover:underline">
                  Open source →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
