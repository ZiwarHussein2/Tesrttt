import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sparkline } from "@/components/ui/sparkline";

// KPI card with current value, previous-period delta, sparkline and a
// calculation definition surfaced via an accessible tooltip (title + aria).
export function KpiCard({
  label,
  value,
  delta,
  deltaLabel = "vs previous period",
  invertDelta = false,
  spark,
  definition,
  href,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  invertDelta?: boolean; // for metrics where "up" is bad (expenses, waits)
  spark?: number[];
  definition?: string;
  href?: string;
  tone?: "warning" | "critical";
  className?: string;
}) {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const positive = hasDelta && (invertDelta ? delta! < 0 : delta! > 0);
  const negative = hasDelta && (invertDelta ? delta! > 0 : delta! < 0);

  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-lg bg-canvas p-4 shadow-card transition-shadow",
        href && "hover:shadow-card-hover",
        className,
      )}
      title={definition}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-mute">{label}</p>
        {tone && (
          <span
            aria-hidden
            className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", tone === "critical" ? "bg-critical" : "bg-warning")}
          />
        )}
      </div>
      <p className="mt-1.5 text-xl font-semibold tracking-[-0.8px] text-ink tabular-nums">{value}</p>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        {hasDelta ? (
          <p
            className={cn(
              "flex items-center gap-0.5 text-[12px] font-medium tabular-nums",
              positive && "text-good-deep",
              negative && "text-critical-deep",
              !positive && !negative && "text-mute",
            )}
          >
            {delta! > 0 ? <ArrowUpRight size={13} /> : delta! < 0 ? <ArrowDownRight size={13} /> : <Minus size={13} />}
            {Math.abs(delta!).toFixed(1)}%
            <span className="sr-only"> {deltaLabel}</span>
          </p>
        ) : (
          <span className="text-[12px] text-mute">—</span>
        )}
        {spark && spark.length > 1 && <Sparkline data={spark} negative={negative} />}
      </div>
      {definition && <span className="sr-only">{definition}</span>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full focus-visible:outline-2">
        {body}
      </Link>
    );
  }
  return body;
}
