import type { Metadata } from "next";
import Link from "next/link";
import { Lock, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { securityStats } from "@/lib/analytics/metrics";
import { fmtDateTime, fmtNumber, fmtPercent, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableShell, THead, Th, Tr, Td, TableEmpty } from "@/components/ui/table";
import { ScoreRing } from "@/components/ui/viz";

export const metadata: Metadata = { title: "Security Center" };

const IMPLEMENTED_CONTROLS: [string, string][] = [
  ["Password hashing (bcrypt)", "Credentials are stored as salted bcrypt hashes."],
  ["Server-side sessions", "DB-backed sessions with revocation and expiry; signed HTTP-only cookies."],
  ["Account lockout", "Accounts lock temporarily after repeated failed sign-ins."],
  ["Role-based least privilege", "Eight roles with per-module read/write access enforced server-side."],
  ["Branch isolation", "Branch Admin accounts are pinned to their branch in every query and action."],
  ["Append-only audit logging", "Every mutation and denied attempt is recorded; no delete path exists."],
  ["Data masking", "Sensitive fields are masked per role at the query/render layer."],
  ["Segregation of duties", "No self-approval of expenses or discounts."],
];

const PLANNED_CONTROLS: [string, string][] = [
  ["HTTPS / WAF at the edge", "Terminate TLS and filter traffic before the application."],
  ["Multi-factor authentication", "MFA structure exists on accounts; enforcement ships with the identity provider."],
  ["Encryption at rest", "Database and file storage encryption at the infrastructure layer."],
  ["Signed file links & scanning", "Result files served via expiring signed URLs after malware scanning."],
  ["Rate limiting", "Per-IP and per-account request limits at the gateway."],
  ["Off-server encrypted backups", "Automated backups with restore testing."],
  ["Device tracking & session timeout", "Managed device registry integrated with attendance checks."],
];

export default async function SecurityPage() {
  const user = await requireUser("security");
  const scope = await getScope(user);

  const sec = await securityStats(scope.branchIds);

  const [recentDenied, sessions, lockedUsers] = await Promise.all([
    db.auditEvent.findMany({
      where: { result: "DENIED" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    db.user.findMany({ where: { lockedUntil: { gt: new Date() } }, select: { email: true, lockedUntil: true } }),
  ]);

  // Posture score from live signals
  const posture = Math.max(0, Math.min(100,
    100
    - sec.openSecurityIncidents * 15
    - sec.openSecurityAlerts * 8
    - sec.lockedUsers * 5
    - Math.min(20, sec.failedLogins7d)
    - (sec.mfaCoverage !== null && sec.mfaCoverage < 50 ? 10 : 0)
    - (sec.suspiciousReportDoctors > 0 ? 10 : 0),
  ));

  return (
    <>
      <PageHeader
        title="Security Center"
        subtitle="Live security posture from real signals, plus the target security architecture for the production deployment."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="col-span-2 flex items-center gap-4 rounded-lg bg-canvas p-4 shadow-card md:col-span-1">
          <ScoreRing score={posture} size={64} label="/100" />
          <div>
            <p className="text-[12px] font-medium text-mute">Security posture</p>
            <p className="text-[11.5px] leading-snug text-body">Computed from incidents, alerts, lockouts and failed sign-ins.</p>
          </div>
        </div>
        <KpiCard label="Active sessions" value={fmtNumber(sec.activeSessions)} />
        <KpiCard label="MFA coverage" value={sec.mfaCoverage !== null ? fmtPercent(sec.mfaCoverage) : "—"} tone={sec.mfaCoverage !== null && sec.mfaCoverage < 50 ? "warning" : undefined} definition="Accounts with the MFA flag enabled. Enforcement ships with the production identity provider." />
        <KpiCard label="Failed sign-ins (7d)" value={fmtNumber(sec.failedLogins7d)} tone={sec.failedLogins7d >= 10 ? "warning" : undefined} />
        <KpiCard label="Locked accounts" value={fmtNumber(sec.lockedUsers)} tone={sec.lockedUsers > 0 ? "warning" : undefined} />
        <KpiCard label="Open security incidents" value={fmtNumber(sec.openSecurityIncidents)} tone={sec.openSecurityIncidents > 0 ? "critical" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Controls in place" subtitle="Enforced by this system today" />
          <CardBody className="space-y-2.5">
            {IMPLEMENTED_CONTROLS.map(([name, detail]) => (
              <div key={name} className="flex items-start gap-2.5 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-good-deep" />
                <div>
                  <p className="text-[13px] font-medium text-ink">{name}</p>
                  <p className="text-[12px] text-mute">{detail}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Target production architecture"
            subtitle="Proposed — not yet active in this deployment"
          />
          <CardBody>
            <pre className="overflow-x-auto thin-scroll rounded-md bg-primary p-4 font-mono text-[11.5px] leading-relaxed text-on-primary">
{`User
  → HTTPS / WAF
  → Application Gateway (rate limits, MFA)
  → Permission Layer (roles, branch isolation)
  → API (validated actions, audit hooks)
  → Private Services
  → Database / Storage / Queue
      (encrypted at rest, signed links,
       off-server backups, restore tests)`}
            </pre>
            <div className="mt-3 space-y-2.5">
              {PLANNED_CONTROLS.map(([name, detail]) => (
                <div key={name} className="flex items-start gap-2.5 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
                  <Lock size={14} className="mt-0.5 shrink-0 text-mute" />
                  <div>
                    <p className="text-[13px] font-medium text-ink">{name} <Badge tone="neutral" className="ml-1">Planned</Badge></p>
                    <p className="text-[12px] text-mute">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Active sessions" subtitle="Server-side sessions that can be revoked" />
          <TableShell className="rounded-t-none shadow-none" dense>
            <THead>
              <Th>User</Th><Th>Role</Th><Th>Network</Th><Th align="right">Started</Th><Th align="right">Expires</Th>
            </THead>
            <tbody>
              {sessions.length === 0 && <TableEmpty colSpan={5}>No active sessions.</TableEmpty>}
              {sessions.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    {s.user.name}
                    <span className="block text-[10.5px] text-mute">{s.user.email}</span>
                  </Td>
                  <Td className="text-[12px]">{s.user.role.replace(/_/g, " ").toLowerCase()}</Td>
                  <Td className="font-mono text-[11px] text-mute">{s.ip ?? "—"}</Td>
                  <Td align="right" className="text-mute">{relativeTime(s.createdAt)}</Td>
                  <Td align="right" className="text-mute">{fmtDateTime(s.expiresAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card>
          <CardHeader
            title="Denied attempts & lockouts"
            actions={<Link href="/audit?result=DENIED" className="text-[12px] font-medium text-link hover:underline">All denied events</Link>}
          />
          <CardBody className="space-y-3">
            {lockedUsers.length > 0 && (
              <div className="rounded-md border border-warning-soft bg-warning-soft/40 p-3">
                <p className="text-[12.5px] font-medium text-warning-deep">Locked accounts</p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-body">
                  {lockedUsers.map((u) => (
                    <li key={u.email}>{u.email} — until {fmtDateTime(u.lockedUntil)}</li>
                  ))}
                </ul>
              </div>
            )}
            {recentDenied.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-mute">No denied attempts recorded.</p>
            ) : (
              <ul className="space-y-2">
                {recentDenied.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 border-t border-hairline pt-2 first:border-0 first:pt-0 text-[12.5px]">
                    <span className="min-w-0">
                      <span className="font-mono text-body">{e.action}</span>
                      <span className="block truncate text-[11px] text-mute">{e.resourceLabel ?? e.reason ?? ""}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-mute">{relativeTime(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
