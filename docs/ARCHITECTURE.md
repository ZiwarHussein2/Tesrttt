# Architecture

## Stack

- **Next.js 16 (App Router)** — server components for every page, server actions for every
  mutation. No client-side data fetching except the command-palette search and the AI chat.
- **TypeScript** end to end, strict.
- **Prisma 6 + SQLite** — local file database today; the schema avoids SQLite-specific features
  so it ports to PostgreSQL (Supabase) unchanged (see `SUPABASE_MIGRATION.md`).
- **Tailwind CSS v4** with the Vercel design language tokens (`DESIGN.md`), Lucide icons,
  Recharts for charts, jsPDF (+autotable) for client-side PDFs.

## Layers

```
src/app/(app)/*          pages (server components) + actions.ts (server actions)
src/lib/permissions.ts   role → module access matrix + masking profiles
src/lib/auth.ts          sessions, password hashing, requireUser()
src/lib/guard.ts         guardWrite() for mutations + branch scoping helpers
src/lib/audit.ts         append-only audit logger (used by every action)
src/lib/scope.ts         global branch-scope + date-range resolution (cookies)
src/lib/analytics/*      metrics.ts (single source of truth), alerts.ts (rule engine)
src/lib/ai/*             provider boundary, local deterministic engine, bottleneck engine
src/lib/reports/*        report assembly for the builder + PDFs
```

### The consistency rule

Every figure shown anywhere — dashboard KPIs, branch pages, Merna AI answers, generated PDFs —
comes from `src/lib/analytics/metrics.ts`. There is deliberately **one** implementation of
"revenue", "attendance rate", "waste rate", "health score", etc., so surfaces can never disagree.

### Authentication & sessions

- Credentials → bcrypt hash comparison → DB `Session` row + JWT (jose, HS256) in an HTTP-only
  cookie carrying `{sessionId, token}`; the token's SHA-256 must match the stored hash.
- Sessions are revocable server-side (sign-out, deactivation, password reset).
- Failed logins increment a counter; 5 failures lock the account for 10 minutes.
- `requireUser(module?)` gates every page; `guardWrite(module)` gates every server action.

### Authorization

`src/lib/permissions.ts` defines, per role: module access (`none | read | write`) and a
**masking profile** (patient contact, employee contact, salaries, finance detail, legal
evidence, security detail). `BRANCH_ADMIN` is additionally pinned to its branch: `getScope()`
forces the branch filter and `branchAllowed()` rejects cross-branch mutations.

### Audit

`logAudit()` writes an append-only `AuditEvent` (actor, role, action, resource, old/new JSON,
reason, result, risk level, IP). The application has **no update or delete path** for audit
events. Management Activities is simply the medium/high-risk slice of this trail.

### Visit state machine

`queues/actions.ts` enforces the radiology lifecycle
(`REGISTERED → PAID/WAITING → CALLED → IN_PROGRESS → SCAN_COMPLETED → PRINTING_COMPLETED →
REPORT_PENDING → REPORT_COMPLETED → COMPLETED`, with `CANCELLED`/`RESCHEDULED` exits) and the
shorter Sonar flow (doctor writes the report during the examination). Transitions validate the
current state server-side; payments create income entries; scan completion consumes the
service recipe from inventory; cancellation of a paid visit posts a refund entry.

### Alert & bottleneck engines

Both are deterministic rule sets over `metrics.ts` data. The alert engine runs at most every
10 minutes (opportunistically from the dashboard/alerts pages, or on demand), keys open alerts
by rule so they never duplicate, auto-resolves cleared conditions and notifies leadership on
critical severity. The bottleneck engine powers "What needs attention", Merna AI and report
findings.

### Merna AI

`MernaAIProvider` (interface) → `LocalMernaAIProvider` (implementation): keyword intent routing
into ~16 handlers that compute from `metrics.ts` + the bottleneck engine and return a structured
answer (direct answer, findings, evidence cards, calculations, risks, actions, confidence,
sources, deep link). Answers are role-masked before leaving the server and every question is
audit-logged. No external AI service is called anywhere — see `GEMMA4_AI.md` for the future
integration rules.

## Design system

`DESIGN.md` (installed with `npx getdesign@latest add vercel`) defines the visual language:
near-white canvas, ink text, hairline borders, stacked shadows, Geist type with negative
tracking, mono eyebrows for technical labels, semantic color only for status. Tokens live in
`src/app/globals.css` under `@theme`; components in `src/components/ui/*`.

Status meaning never relies on color alone (badges carry text + dot shapes), focus rings are
visible, reduced motion is honored, and tables scroll inside their own container on small
screens while the mobile shell switches to a bottom navigation.
