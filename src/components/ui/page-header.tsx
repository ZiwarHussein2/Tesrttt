import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("mb-5", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1 text-[12px] text-mute">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={12} aria-hidden />}
              {b.href ? (
                <Link href={b.href} className="hover:text-ink hover:underline">
                  {b.label}
                </Link>
              ) : (
                <span className="text-body">{b.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.8px] text-ink sm:text-2xl sm:tracking-[-0.96px]">
            {title}
          </h1>
          {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-body">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
