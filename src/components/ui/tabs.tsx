import Link from "next/link";
import { cn } from "@/lib/cn";

// URL-driven tabs (server-rendered).
export function Tabs({
  tabs,
  current,
  className,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 overflow-x-auto thin-scroll border-b border-hairline", className)}>
      <nav aria-label="Tabs" className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative whitespace-nowrap px-3 py-2 text-[13px] transition-colors",
                active ? "font-medium text-ink" : "text-mute hover:text-body",
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium", active ? "bg-primary text-on-primary" : "bg-canvas-soft-2 text-mute")}>
                  {tab.count}
                </span>
              )}
              {active && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
