"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Activity, Sparkles, ChartPie, TrendingUp, Receipt,
  Wallet, Banknote, Target, BadgePercent, Users, CalendarCheck, Clock, FileSignature,
  BookOpen, ChartColumn, Grid2x2, ListOrdered, Scan, FileText, UserPlus, HeartPulse,
  Package, PackageX, History, Landmark, Presentation, Scale, ScrollText, ShieldCheck,
  Lock, TriangleAlert, Bell, FileOutput, Settings, Menu, Search, PanelLeftClose,
  PanelLeftOpen, LogOut, ChevronDown, X, EllipsisVertical,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import type { NavSection } from "@/components/shell/nav";
import { setBranchScope, setDateRange, logoutAction } from "@/app/(app)/shell-actions";
import { CommandPalette } from "@/components/shell/command-palette";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Building2, Activity, Sparkles, ChartPie, TrendingUp, Receipt,
  Wallet, Banknote, Target, BadgePercent, Users, CalendarCheck, Clock, FileSignature,
  BookOpen, ChartColumn, Grid2x2, ListOrdered, Scan, FileText, UserPlus, HeartPulse,
  Package, PackageX, History, Landmark, Presentation, Scale, ScrollText, ShieldCheck,
  Lock, TriangleAlert, Bell, FileOutput, Settings,
};

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  branchName: string | null;
}

export interface ShellScope {
  branchId: string | null;
  range: string;
  pinned: boolean;
}

const RANGE_LABELS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  year: "This year",
};

export function AppShell({
  user,
  companyName,
  branches,
  scope,
  sections,
  unreadCount,
  children,
}: {
  user: ShellUser;
  companyName: string;
  branches: { id: string; name: string }[];
  scope: ShellScope;
  sections: NavSection[];
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    setCollapsed(localStorage.getItem("mcc_sidebar") === "collapsed");
  }, []);

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("mcc_sidebar", next ? "collapsed" : "open");
  };

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  const sidebarContent = (showLabels: boolean) => (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto thin-scroll px-2 pb-6">
      {sections.map((section) => (
        <div key={section.title} className="mt-4 first:mt-2">
          {showLabels && (
            <p className="px-2 pb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">
              {section.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon] ?? LayoutDashboard;
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={showLabels ? undefined : item.label}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-canvas-soft-2 font-medium text-ink"
                        : "text-body hover:bg-canvas-soft-2 hover:text-ink",
                      !showLabels && "justify-center px-0",
                    )}
                  >
                    <Icon size={16} strokeWidth={1.75} className={cn(active ? "text-ink" : "text-mute")} />
                    {showLabels && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const mobileNav = [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Branches", href: "/branches", icon: Building2 },
    { label: "Alerts", href: "/alerts", icon: Bell },
    { label: "Merna AI", href: "/merna-ai", icon: Sparkles },
  ].filter((i) => sections.some((s) => s.items.some((it) => it.href === i.href)));

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-hairline bg-canvas transition-[width] lg:flex",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div className={cn("flex h-14 items-center gap-2 border-b border-hairline px-3", collapsed && "justify-center px-0")}>
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-on-primary">
              M
            </span>
            {!collapsed && (
              <span className="truncate">
                <span className="block truncate text-[13px] font-semibold leading-tight text-ink">Merna Control Center</span>
                <span className="block truncate text-[11px] leading-tight text-mute">{companyName}</span>
              </span>
            )}
          </Link>
        </div>
        {sidebarContent(!collapsed)}
        <div className="border-t border-hairline p-2">
          <button
            onClick={toggleCollapsed}
            className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-mute hover:bg-canvas-soft-2 hover:text-ink"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            className="absolute inset-0 bg-black/30"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-canvas shadow-modal">
            <div className="flex h-14 items-center justify-between border-b border-hairline px-4">
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-on-primary">M</span>
                <span className="text-[13px] font-semibold text-ink">Merna Control Center</span>
              </span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-md p-1.5 text-mute hover:bg-canvas-soft-2">
                <X size={18} />
              </button>
            </div>
            {sidebarContent(true)}
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-hairline bg-canvas/95 px-3 backdrop-blur sm:px-4">
          <button
            className="rounded-md p-2 text-body hover:bg-canvas-soft-2 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>

          {/* Branch scope */}
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="branch-scope">Branch scope</label>
            <select
              id="branch-scope"
              value={scope.branchId ?? "ALL"}
              disabled={scope.pinned}
              onChange={(e) => startTransition(() => setBranchScope(e.target.value))}
              className={cn(
                "h-8 max-w-[150px] cursor-pointer appearance-none rounded-md border border-hairline bg-canvas pl-2.5 pr-7 text-[13px] font-medium text-ink outline-none transition-colors hover:border-hairline-strong sm:max-w-[210px]",
                "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_8px_center] bg-no-repeat",
                scope.pinned && "cursor-not-allowed opacity-70",
              )}
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <label className="sr-only" htmlFor="date-range">Date range</label>
            <select
              id="date-range"
              value={scope.range}
              onChange={(e) => startTransition(() => setDateRange(e.target.value))}
              className={cn(
                "hidden h-8 cursor-pointer appearance-none rounded-md border border-hairline bg-canvas pl-2.5 pr-7 text-[13px] text-body outline-none transition-colors hover:border-hairline-strong sm:block",
                "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_8px_center] bg-no-repeat",
              )}
            >
              {Object.entries(RANGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          {/* Search / command palette */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-2 rounded-md border border-hairline bg-canvas px-3 text-[13px] text-mute transition-colors hover:border-hairline-strong md:flex"
            aria-label="Open command palette"
          >
            <Search size={14} />
            <span>Search…</span>
            <kbd className="ml-4 rounded border border-hairline bg-canvas-soft px-1.5 font-mono text-[10px] text-mute">⌘K</kbd>
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="rounded-md p-2 text-body hover:bg-canvas-soft-2 md:hidden"
            aria-label="Search"
          >
            <Search size={18} />
          </button>

          {/* Merna AI shortcut */}
          <Link
            href="/merna-ai"
            className="hidden h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] font-medium text-violet-deep transition-colors hover:border-violet hover:bg-ai-soft sm:flex"
          >
            <Sparkles size={14} />
            Merna AI
          </Link>

          {/* Notifications */}
          <Link
            href="/notifications"
            className="relative rounded-md p-2 text-body hover:bg-canvas-soft-2"
            aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>

          <UserMenu user={user} />
        </header>

        {/* Page content */}
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-3 pb-24 pt-4 sm:px-5 lg:px-6 lg:pb-10">
          {children}
        </main>

        <footer className="hidden border-t border-hairline px-6 py-3 lg:block">
          <p className="text-[11px] text-mute">
            Confidential — {companyName} management system. Operated by Merna Control Center. All activity is audited.
          </p>
        </footer>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-canvas/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {mobileNav.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
                active ? "font-medium text-ink" : "text-mute",
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.icon size={18} strokeWidth={active ? 2 : 1.75} />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-mute"
          aria-label="More navigation"
        >
          <EllipsisVertical size={18} strokeWidth={1.75} />
          More
        </button>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sections={sections}
        branches={branches}
        pinned={scope.pinned}
      />
    </div>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md p-1 pr-1.5 hover:bg-canvas-soft-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary">
          {initials(user.name)}
        </span>
        <ChevronDown size={14} className="hidden text-mute sm:block" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg bg-canvas p-1.5 shadow-modal"
        >
          <div className="border-b border-hairline px-2.5 pb-2.5 pt-1.5">
            <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
            <p className="truncate text-[12px] text-mute">{user.email}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-canvas-soft-2 px-2 py-0.5 text-[11px] font-medium text-body">
              {user.roleLabel}
              {user.branchName ? ` · ${user.branchName}` : ""}
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-body hover:bg-canvas-soft-2 hover:text-ink"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
