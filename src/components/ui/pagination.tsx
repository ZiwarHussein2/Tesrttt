import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function Pagination({
  page,
  pageCount,
  makeHref,
  total,
  className,
}: {
  page: number;
  pageCount: number;
  makeHref: (page: number) => string;
  total?: number;
  className?: string;
}) {
  if (pageCount <= 1) {
    return total !== undefined ? (
      <p className={cn("mt-2 text-[12px] text-mute", className)}>{total} record{total === 1 ? "" : "s"}</p>
    ) : null;
  }
  return (
    <div className={cn("mt-3 flex items-center justify-between gap-2", className)}>
      <p className="text-[12px] text-mute">
        Page {page} of {pageCount}
        {total !== undefined && ` · ${total} records`}
      </p>
      <div className="flex items-center gap-1">
        <PageLink disabled={page <= 1} href={makeHref(page - 1)} label="Previous page">
          <ChevronLeft size={14} />
        </PageLink>
        <PageLink disabled={page >= pageCount} href={makeHref(page + 1)} label="Next page">
          <ChevronRight size={14} />
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  disabled,
  href,
  label,
  children,
}: {
  disabled: boolean;
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-mute opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-body transition-colors hover:border-hairline-strong hover:text-ink"
    >
      {children}
    </Link>
  );
}
