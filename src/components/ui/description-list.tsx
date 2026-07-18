import * as React from "react";
import { cn } from "@/lib/cn";

export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11.5px] font-medium uppercase tracking-wide text-mute">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
