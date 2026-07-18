import * as React from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "ok" | "good" | "warning" | "critical" | "ai" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-canvas-soft-2 text-body",
  ok: "bg-ok-soft text-ok-deep",
  good: "bg-good-soft text-good-deep",
  warning: "bg-warning-soft text-warning-deep",
  critical: "bg-critical-soft text-critical-deep",
  ai: "bg-ai-soft text-violet-deep",
  outline: "bg-canvas text-body border border-hairline",
};

// Status meaning must never depend on color alone — badges always carry text,
// and `dot` adds a shape cue for scanning.
export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", {
            "bg-mute": tone === "neutral" || tone === "outline",
            "bg-ok": tone === "ok",
            "bg-good": tone === "good",
            "bg-warning": tone === "warning",
            "bg-critical": tone === "critical",
            "bg-ai": tone === "ai",
          })}
        />
      )}
      {children}
    </span>
  );
}

// Map common status strings to tones so every module renders them consistently.
export function statusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (["OPERATING", "ACTIVE", "PRESENT", "APPROVED", "ACCEPTED", "COMPLETED", "PAID", "RESOLVED", "CLOSED", "AVAILABLE", "REVIEWED", "REIMBURSED", "MATCHED", "INSIDE_ZONE", "HELD", "ONLINE", "GRANTED"].includes(s)) return "good";
  if (["IN_PROGRESS", "IN_USE", "CALLED", "WAITING", "ISSUED", "UNDER_REVIEW", "INVESTIGATING", "ASSIGNED", "TRIAGED", "CONTAINED", "SCAN_COMPLETED", "PRINTING_COMPLETED", "REPORT_COMPLETED", "PARTIAL", "SCHEDULED", "DRAFT"].includes(s)) return "ok";
  if (["LATE", "PENDING", "REPORT_PENDING", "SUBMITTED", "ON_LEAVE", "LEAVE", "MAINTENANCE", "LIMITED", "WARNING", "REGISTERED", "SETUP", "RESCHEDULED", "UNPAID", "REVIEW", "UNKNOWN", "MEDIUM", "SNOOZED", "PENDING_REVIEW"].includes(s)) return "warning";
  if (["ABSENT", "SUSPENDED", "TERMINATED", "REJECTED", "CANCELLED", "OFFLINE", "CRITICAL", "HIGH", "DECLINED", "MISMATCH", "OUTSIDE_ZONE", "OPEN", "DETECTED", "FAILURE", "DENIED", "REFUNDED", "WITHDRAWN", "ENDED"].includes(s)) return "critical";
  return "neutral";
}
