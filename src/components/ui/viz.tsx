import * as React from "react";
import { cn } from "@/lib/cn";
import { fmtNumber } from "@/lib/format";

// Server-renderable visualizations (no chart library): horizontal bar lists,
// funnels, heat grids, bullet bars, progress meters.

export function HBarList({
  items,
  money = false,
  className,
}: {
  items: { label: string; value: number; sublabel?: string; color?: string }[];
  money?: boolean;
  className?: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className={cn("space-y-2.5", className)}>
      {items.map((item, i) => (
        <div key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="truncate text-body">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-ink">
              {money ? `${fmtNumber(item.value)} IQD` : fmtNumber(item.value)}
              {item.sublabel && <span className="ml-1 font-normal text-mute">{item.sublabel}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas-soft-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${(Math.abs(item.value) / max) * 100}%`, background: item.color ?? "var(--chart-ink)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FunnelSteps({
  steps,
  className,
}: {
  steps: { label: string; value: number }[];
  className?: string;
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className={cn("space-y-1.5", className)}>
      {steps.map((step, i) => {
        const pct = (step.value / max) * 100;
        const dropoff = i > 0 && steps[i - 1].value > 0
          ? ((steps[i - 1].value - step.value) / steps[i - 1].value) * 100
          : null;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="w-36 shrink-0 truncate text-right text-[12px] text-body sm:w-44">{step.label}</div>
            <div className="relative h-7 flex-1 overflow-hidden rounded bg-canvas-soft-2">
              <div className="flex h-full items-center rounded bg-primary pl-2" style={{ width: `${Math.max(pct, 3)}%` }}>
                <span className="text-[11px] font-medium text-on-primary tabular-nums">{fmtNumber(step.value)}</span>
              </div>
            </div>
            <div className="w-14 shrink-0 text-[11px] text-mute tabular-nums">
              {dropoff !== null && dropoff > 0 ? `−${dropoff.toFixed(0)}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// value/target bullet bar with threshold coloring
export function BulletBar({
  label,
  value,
  target,
  unit = "",
  higherIsBetter = true,
  className,
}: {
  label: string;
  value: number;
  target: number;
  unit?: string;
  higherIsBetter?: boolean;
  className?: string;
}) {
  const ratio = target > 0 ? value / target : 0;
  const good = higherIsBetter ? ratio >= 1 : ratio <= 1;
  const width = Math.min(ratio * 100, 100);
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
        <span className="text-body">{label}</span>
        <span className="font-medium tabular-nums text-ink">
          {fmtNumber(value)}{unit} <span className="font-normal text-mute">/ {fmtNumber(target)}{unit} target</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-canvas-soft-2">
        <div className={cn("h-full rounded-full", good ? "bg-good" : "bg-critical")} style={{ width: `${width}%` }} />
        <div className="absolute top-0 h-full w-px bg-ink" style={{ left: "100%" }} />
      </div>
    </div>
  );
}

// Heat grid (e.g. attendance by branch × weekday, queue pressure by dept × hour)
export function HeatGrid({
  rows,
  cols,
  cells,
  legend = "Low → High",
  className,
}: {
  rows: string[];
  cols: string[];
  cells: number[][]; // rows × cols, values 0..1 normalized
  legend?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto thin-scroll", className)}>
      <table className="w-full min-w-max border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="pr-2 text-left" />
            {cols.map((c) => (
              <th key={c} className="px-1 pb-1 text-center font-mono text-[9.5px] font-medium uppercase text-mute">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="whitespace-nowrap pr-2 text-[12px] text-body">{r}</td>
              {cols.map((c, ci) => {
                const v = cells[ri]?.[ci] ?? 0;
                return (
                  <td key={c} className="p-0">
                    <div
                      className="h-7 min-w-9 rounded-sm"
                      title={`${r} · ${c}: ${(v * 100).toFixed(0)}%`}
                      style={{ background: `rgba(var(--heat-rgb), ${0.05 + v * 0.85})` }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-mute">{legend}</p>
    </div>
  );
}

export function ScoreRing({
  score,
  size = 64,
  label,
}: {
  score: number; // 0-100
  size?: number;
  label?: string;
}) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  const color = score >= 80 ? "var(--color-good-deep)" : score >= 60 ? "var(--color-warning-deep)" : "var(--color-critical-deep)";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-canvas-soft-2)" strokeWidth="5" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${filled} ${c - filled}`} strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-sm font-semibold tabular-nums text-ink">{Math.round(score)}</p>
        {label && <p className="text-[9px] text-mute">{label}</p>}
      </div>
    </div>
  );
}
