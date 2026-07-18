import * as React from "react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={cn("rounded-lg bg-canvas shadow-card", className)}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-[-0.28px] text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12px] text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
