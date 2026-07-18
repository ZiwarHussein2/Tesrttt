import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canRead, isBranchScoped } from "@/lib/permissions";
import { getScope } from "@/lib/scope";
import { ROLE_LABELS, type Role } from "@/types/enums";
import { NAV_SECTIONS } from "@/components/shell/nav";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [company, branches, unreadCount] = await Promise.all([
    db.company.findFirst({ select: { name: true } }),
    db.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  if (!company) redirect("/setup");

  const scope = await getScope(user);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canRead(user.role, item.module)),
  })).filter((section) => section.items.length > 0);

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role as Role] ?? user.role,
        branchName: user.branchName,
      }}
      companyName={company.name}
      branches={branches}
      scope={{
        branchId: scope.branchId,
        range: scope.range,
        pinned: isBranchScoped(user.role),
      }}
      sections={sections}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
