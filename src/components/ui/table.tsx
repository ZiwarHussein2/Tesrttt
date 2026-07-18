import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";

// Server-rendered data table primitives. Sorting is URL-driven: column headers
// link to ?sort=<key>&dir=<asc|desc> so tables stay server components.

export function TableShell({
  children,
  className,
  dense,
}: {
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div className={cn("overflow-x-auto thin-scroll rounded-lg bg-canvas shadow-card", className)}>
      <table className={cn("w-full min-w-max border-collapse text-left", dense ? "text-[12.5px]" : "text-[13px]")}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-hairline bg-canvas-soft">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-wider text-mute",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </th>
  );
}

// Sortable header cell — renders a link that toggles sort direction.
export function ThSort({
  label,
  sortKey,
  currentSort,
  currentDir,
  makeHref,
  align = "left",
  className,
}: {
  label: string;
  sortKey: string;
  currentSort?: string;
  currentDir?: string;
  makeHref: (sort: string, dir: string) => string;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const active = currentSort === sortKey;
  const nextDir = active && currentDir === "desc" ? "asc" : "desc";
  return (
    <Th align={align} className={className}>
      <Link
        href={makeHref(sortKey, nextDir)}
        className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}
      >
        {label}
        {active && (currentDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </Link>
    </Th>
  );
}

export function Tr({
  children,
  className,
  highlight,
}: {
  children: React.ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <tr
      className={cn(
        "border-b border-hairline last:border-0 transition-colors hover:bg-canvas-soft",
        highlight && "bg-warning-soft/30",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  align = "left",
  mono,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle text-body",
        align === "right" && "text-right tabular-nums",
        align === "center" && "text-center",
        mono && "font-mono text-[12px]",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-[13px] text-mute">
        {children}
      </td>
    </tr>
  );
}
