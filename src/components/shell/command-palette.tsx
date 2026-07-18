"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowRight, Building2, CornerDownLeft, Loader2, Search } from "lucide-react";
import type { NavSection } from "@/components/shell/nav";
import { setBranchScope, setDateRange } from "@/app/(app)/shell-actions";

interface SearchResult {
  type: string;
  label: string;
  sublabel?: string;
  href: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  sections,
  branches,
  pinned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: NavSection[];
  branches: { id: string; name: string }[];
  pinned: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Debounced global entity search
  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = (await res.json()) as { results: SearchResult[] };
          setResults(data.results);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={() => onOpenChange(false)} />
      <Command
        shouldFilter={query.trim().length < 2}
        className="relative w-full max-w-xl overflow-hidden rounded-xl bg-canvas shadow-modal"
        label="Global command palette"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-mute" />
          ) : (
            <Search size={16} className="text-mute" />
          )}
          <Command.Input
            value={query}
            onValueChange={setQuery}
            autoFocus
            placeholder="Search pages, employees, expenses, patients, alerts…"
            className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-mute"
          />
          <kbd className="rounded border border-hairline bg-canvas-soft px-1.5 font-mono text-[10px] text-mute">esc</kbd>
        </div>
        <Command.List className="max-h-[55vh] overflow-y-auto thin-scroll p-2">
          <Command.Empty className="px-3 py-8 text-center text-[13px] text-mute">
            {loading ? "Searching…" : "No matches. Try a different term."}
          </Command.Empty>

          {results.length > 0 && (
            <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mute">
              {results.map((r, i) => (
                <Command.Item
                  key={`${r.href}-${i}`}
                  value={`result-${r.label}-${i}`}
                  onSelect={() => go(r.href)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-body aria-selected:bg-canvas-soft-2 aria-selected:text-ink"
                >
                  <span className="rounded bg-canvas-soft-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-mute">{r.type}</span>
                  <span className="truncate">{r.label}</span>
                  {r.sublabel && <span className="truncate text-[12px] text-mute">{r.sublabel}</span>}
                  <CornerDownLeft size={12} className="ml-auto shrink-0 text-mute" />
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {sections.map((section) => (
            <Command.Group
              key={section.title}
              heading={section.title}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mute"
            >
              {section.items.map((item) => (
                <Command.Item
                  key={item.href}
                  value={`${section.title} ${item.label}`}
                  onSelect={() => go(item.href)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-body aria-selected:bg-canvas-soft-2 aria-selected:text-ink"
                >
                  <ArrowRight size={13} className="text-mute" />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          ))}

          {!pinned && branches.length > 0 && (
            <Command.Group
              heading="Branch scope"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mute"
            >
              <Command.Item
                value="scope all branches"
                onSelect={() => {
                  startTransition(() => setBranchScope("ALL"));
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-body aria-selected:bg-canvas-soft-2 aria-selected:text-ink"
              >
                <Building2 size={13} className="text-mute" />
                Scope: All Branches
              </Command.Item>
              {branches.map((b) => (
                <Command.Item
                  key={b.id}
                  value={`scope branch ${b.name}`}
                  onSelect={() => {
                    startTransition(() => setBranchScope(b.id));
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-body aria-selected:bg-canvas-soft-2 aria-selected:text-ink"
                >
                  <Building2 size={13} className="text-mute" />
                  Scope: {b.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group
            heading="Date range"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-mute"
          >
            {(["7d", "30d", "90d", "month", "year"] as const).map((r) => (
              <Command.Item
                key={r}
                value={`range ${r} days period`}
                onSelect={() => {
                  startTransition(() => setDateRange(r));
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-body aria-selected:bg-canvas-soft-2 aria-selected:text-ink"
              >
                <ArrowRight size={13} className="text-mute" />
                Range: {r === "7d" ? "Last 7 days" : r === "30d" ? "Last 30 days" : r === "90d" ? "Last 90 days" : r === "month" ? "This month" : "This year"}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
