"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

// URL-driven table controls: a debounced search box and select filters that
// write to searchParams, so the (server) page re-queries with the new state.

export function SearchInput({
  param = "q",
  placeholder = "Search…",
  className,
}: {
  param?: string;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(searchParams.get(param) ?? "");
  const first = React.useRef(true);

  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(param, value);
      else params.delete(param);
      params.delete("page");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={cn("relative", className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-md border border-hairline bg-canvas pl-8 pr-8 text-[13px] text-ink outline-none transition-colors placeholder:text-mute hover:border-hairline-strong focus:border-ink"
      />
      {value && (
        <button
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-mute hover:text-ink"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({
  param,
  options,
  allLabel = "All",
  className,
  label,
}: {
  param: string;
  options: { value: string; label: string }[];
  allLabel?: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? "";

  return (
    <select
      value={current}
      aria-label={label ?? param}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set(param, e.target.value);
        else params.delete(param);
        params.delete("page");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className={cn(
        "h-8 cursor-pointer appearance-none rounded-md border border-hairline bg-canvas pl-2.5 pr-7 text-[13px] text-body outline-none transition-colors hover:border-hairline-strong focus:border-ink",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_8px_center] bg-no-repeat",
        className,
      )}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-3 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
