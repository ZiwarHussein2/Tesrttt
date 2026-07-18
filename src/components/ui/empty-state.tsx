import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg bg-canvas-soft px-6 py-14 text-center shadow-card", className)}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-canvas-soft-2 text-mute">
        {icon ?? <Inbox size={18} strokeWidth={1.5} />}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-body">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
