import type { Metadata } from "next";
import { KeyRound, Plus, UserCog } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ActionDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Hint } from "@/components/ui/input";
import { DescriptionList } from "@/components/ui/description-list";
import { ROLES, ROLE_LABELS, type Role } from "@/types/enums";
import { changeOwnPassword, createUser, resetUserPassword, updateCompany, updateUser } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const TABS = ["company", "users", "account", "data"] as const;
type Tab = (typeof TABS)[number];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser("settings");
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "company";
  const writable = canWrite(user.role, "settings");

  const [company, users, branches, employees, counts] = await Promise.all([
    db.company.findFirst(),
    db.user.findMany({
      include: { branch: { select: { name: true } }, employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { user: null, employmentStatus: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: { firstName: "asc" },
    }),
    Promise.all([
      db.branch.count(), db.employee.count(), db.patient.count(), db.visit.count(),
      db.expense.count(), db.auditEvent.count(), db.inventoryItem.count(),
    ]),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Company identity, user accounts, your own credentials and system data."
      />
      <Tabs
        tabs={TABS.map((t) => ({
          key: t,
          label: t === "company" ? "Company" : t === "users" ? "Users & Roles" : t === "account" ? "My Account" : "Data & Migration",
          href: `/settings?tab=${t}`,
        }))}
        current={tab}
      />

      {tab === "company" && company && (
        <Card className="max-w-2xl">
          <CardHeader title="Company" subtitle="Used across the panel and on formal reports" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Name", value: company.name },
                { label: "Legal name", value: company.legalName ?? "—" },
                { label: "Registration no.", value: company.registrationNo ?? "—" },
                { label: "Currency", value: company.currency },
                { label: "Timezone", value: company.timezone },
                { label: "Created", value: fmtDateTime(company.createdAt) },
              ]}
            />
            {writable && (
              <div className="mt-4 border-t border-hairline pt-4">
                <ActionDialog
                  trigger="Edit company"
                  triggerVariant="primary"
                  title="Edit company"
                  description="Company identity changes are high-risk audited actions."
                  action={updateCompany}
                  submitLabel="Save changes"
                >
                  <div>
                    <Label htmlFor="co-name" required>Company name</Label>
                    <Input id="co-name" name="name" defaultValue={company.name} required />
                  </div>
                  <div>
                    <Label htmlFor="co-legal">Legal name</Label>
                    <Input id="co-legal" name="legalName" defaultValue={company.legalName ?? ""} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="co-reg">Registration no.</Label>
                      <Input id="co-reg" name="registrationNo" defaultValue={company.registrationNo ?? ""} />
                    </div>
                    <div>
                      <Label htmlFor="co-tz">Timezone</Label>
                      <Input id="co-tz" name="timezone" defaultValue={company.timezone} />
                    </div>
                  </div>
                </ActionDialog>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "users" && (
        <Card>
          <CardHeader
            title="User accounts"
            subtitle="Real accounts with role-based access. New users must change their temporary password at first sign-in."
            actions={
              writable ? (
                <ActionDialog
                  trigger={<><Plus size={13} /> New account</>}
                  triggerVariant="primary"
                  title="Create user account"
                  description="Assign the role carefully — it controls module access, write permissions and data masking."
                  action={createUser}
                  submitLabel="Create account"
                  wide
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="nu-name" required>Full name</Label>
                      <Input id="nu-name" name="name" required />
                    </div>
                    <div>
                      <Label htmlFor="nu-email" required>Email</Label>
                      <Input id="nu-email" name="email" type="email" required />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="nu-role" required>Role</Label>
                      <Select id="nu-role" name="role" defaultValue="BRANCH_ADMIN">
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="nu-branch">Branch (required for Branch Admin)</Label>
                      <Select id="nu-branch" name="branchId" defaultValue="">
                        <option value="">— None (group-level) —</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="nu-emp">Link to employee record</Label>
                    <Select id="nu-emp" name="employeeId" defaultValue="">
                      <option value="">— Not linked —</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="nu-pass" required>Temporary password</Label>
                    <Input id="nu-pass" name="password" type="text" required placeholder="At least 10 characters" />
                    <Hint>Share it securely; the user must change it at first sign-in.</Hint>
                  </div>
                </ActionDialog>
              ) : undefined
            }
          />
          <TableShell className="rounded-t-none shadow-none">
            <THead>
              <Th>Account</Th><Th>Role</Th><Th>Branch</Th><Th>Employee</Th><Th>Status</Th><Th align="right">Last login</Th>
              {writable && <Th align="right">Actions</Th>}
            </THead>
            <tbody>
              {users.length === 0 && <TableEmpty colSpan={writable ? 7 : 6}>No accounts.</TableEmpty>}
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <span className="font-medium text-ink">{u.name}</span>
                    <span className="block text-[11px] text-mute">{u.email}</span>
                  </Td>
                  <Td>{ROLE_LABELS[u.role as Role] ?? u.role}</Td>
                  <Td>{u.branch?.name ?? "—"}</Td>
                  <Td>{u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : "—"}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={u.isActive ? "good" : "critical"} dot>{u.isActive ? "Active" : "Disabled"}</Badge>
                      {u.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
                      {u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="critical">Locked</Badge>}
                    </span>
                  </Td>
                  <Td align="right" className="text-mute">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</Td>
                  {writable && (
                    <Td align="right">
                      <span className="flex justify-end gap-1.5">
                        <ActionDialog
                          trigger={<UserCog size={12} />}
                          triggerSize="icon"
                          title={`Edit account — ${u.name}`}
                          description="Role, branch and status changes are high-risk audited actions."
                          action={updateUser}
                          submitLabel="Save"
                        >
                          <input type="hidden" name="userId" value={u.id} />
                          <div>
                            <Label htmlFor={`ur-${u.id}`}>Role</Label>
                            <Select id={`ur-${u.id}`} name="role" defaultValue={u.role}>
                              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`ub-${u.id}`}>Branch</Label>
                            <Select id={`ub-${u.id}`} name="branchId" defaultValue={u.branchId ?? ""}>
                              <option value="">— None (group-level) —</option>
                              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`ua-${u.id}`}>Status</Label>
                            <Select id={`ua-${u.id}`} name="isActive" defaultValue={u.isActive ? "true" : "false"}>
                              <option value="true">Active</option>
                              <option value="false">Disabled (revokes sessions)</option>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`urr-${u.id}`} required>Reason</Label>
                            <Input id={`urr-${u.id}`} name="reason" required placeholder="Recorded in the audit log" />
                          </div>
                        </ActionDialog>
                        <ActionDialog
                          trigger={<KeyRound size={12} />}
                          triggerSize="icon"
                          title={`Reset password — ${u.name}`}
                          description="Sets a temporary password, revokes all sessions and requires a change at next sign-in."
                          action={resetUserPassword}
                          submitLabel="Reset password"
                        >
                          <input type="hidden" name="userId" value={u.id} />
                          <div>
                            <Label htmlFor={`up-${u.id}`} required>Temporary password</Label>
                            <Input id={`up-${u.id}`} name="password" type="text" required placeholder="At least 10 characters" />
                          </div>
                        </ActionDialog>
                      </span>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      )}

      {tab === "account" && (
        <Card className="max-w-xl">
          <CardHeader title="My account" subtitle={`Signed in as ${user.email} — ${ROLE_LABELS[user.role as Role]}`} />
          <CardBody>
            <ActionDialog
              trigger="Change my password"
              triggerVariant="primary"
              title="Change password"
              action={changeOwnPassword}
              submitLabel="Update password"
            >
              <div>
                <Label htmlFor="cp-cur" required>Current password</Label>
                <Input id="cp-cur" name="currentPassword" type="password" autoComplete="current-password" required />
              </div>
              <div>
                <Label htmlFor="cp-new" required>New password</Label>
                <Input id="cp-new" name="newPassword" type="password" autoComplete="new-password" required />
                <Hint>At least 10 characters.</Hint>
              </div>
            </ActionDialog>
          </CardBody>
        </Card>
      )}

      {tab === "data" && (
        <div className="grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Data on record" subtitle="Live database contents" />
            <CardBody>
              <DescriptionList
                columns={2}
                items={[
                  { label: "Branches", value: fmtNumber(counts[0]) },
                  { label: "Employees", value: fmtNumber(counts[1]) },
                  { label: "Patients", value: fmtNumber(counts[2]) },
                  { label: "Visits", value: fmtNumber(counts[3]) },
                  { label: "Expenses", value: fmtNumber(counts[4]) },
                  { label: "Audit events", value: fmtNumber(counts[5]) },
                  { label: "Inventory items", value: fmtNumber(counts[6]) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Storage & migration" />
            <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-body">
              <p>
                The system currently runs on a local SQLite database via Prisma ORM. The schema is written to be
                portable: migrating to Supabase (PostgreSQL) is a provider switch plus data transfer — see{" "}
                <code className="rounded bg-canvas-soft-2 px-1 font-mono text-[11px]">docs/SUPABASE_MIGRATION.md</code>{" "}
                in the repository.
              </p>
              <p>
                Branch systems will connect through the documented integration contract
                (<code className="rounded bg-canvas-soft-2 px-1 font-mono text-[11px]">docs/INTEGRATION.md</code>) —
                attendance devices, reception software and lab systems push records through authenticated APIs that
                reuse the same validation and audit paths as this panel.
              </p>
              <p className="text-mute">
                Audit events are append-only and are never deleted by the application.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
