# Merna Control Center

The central management system of **Merna Medical Company** — executive, operational, financial,
workforce, governance, compliance, privacy, security and intelligence in one panel.
Product and concept ownership: GashtySoft, the software division of Gashty Limited HK.

This is a **real production system**, not a demo: it starts empty and is filled through real
workflows. All figures across dashboards, Merna AI and generated PDFs come from the same
aggregation functions, so they always reconcile.

## Quick start

```bash
npm install
cp .env.example .env          # set a strong AUTH_SECRET in production
npx prisma migrate deploy     # creates the local SQLite database
npm run build
npm start                     # or: npm run dev
```

Open the app — the **first run** shows a setup wizard that creates the company record and the
Super Admin account. From there:

1. Create branches (Branches → New branch)
2. Add departments, machines, services and pricing windows per branch
3. Register employees, issue agreements, publish policies
4. Create user accounts for your team (Settings → Users & Roles)
5. Operate: queues, payments, attendance, expenses, inventory

## What's inside

| Area | Modules |
|---|---|
| Overview | Executive dashboard, branch directory & comparison, live operations, Merna AI |
| Finance | Overview, income, expenses (review workflow + anomaly scoring), employee expenses, payroll runs, budgets, discounts (request → approval) |
| Workforce | Employees, attendance (+corrections with evidence), overtime, versioned agreements with acceptance evidence, policies, analytics |
| Operations | Departments, per-department queues (full visit state machine), radiology operations, report workflow & reading doctors, referral doctors & deals, patients (masked), inventory & movements, waste & variance |
| Governance | Alerts (rule engine), incidents (8-step workflow), append-only audit logs, management activities, legal accountability + evidence packages, privacy center, security center, shareholders & board |
| System | Notifications, report builder (client-side PDF), settings & user management |

## Key properties

- **Real auth**: bcrypt password hashes, DB-backed revocable sessions, signed HTTP-only cookies,
  lockout after repeated failures, forced password change for new accounts.
- **8 real roles** with per-module read/write access, branch isolation for Branch Admins and
  role-based data masking — enforced server-side in every query and action.
- **Append-only audit trail**: every mutation, denied attempt, export and AI question is recorded
  with old/new values and reasons. No delete path exists.
- **Merna AI**: a local deterministic analysis engine (no external AI call, no API key) behind a
  provider interface ready for a future Gemma 4 server-side integration — see `docs/GEMMA4_AI.md`.
- **Client-side PDFs**: formal reports and AI analyses are generated in the browser (jsPDF).
- **Light & dark themes**: full token-based theming with a top-bar toggle, system-preference
  default, no flash on load, theme-aware charts — and formal documents always print in light.
- **Responsive**: desktop sidebar → tablet drawer → mobile bottom navigation; WCAG-minded
  focus, labels, color-independent status badges and reduced-motion support.

## Repository layout

```
prisma/            schema + migrations (SQLite now, Postgres-portable)
src/app/(auth)     login + first-run setup
src/app/(app)      all authenticated modules (server components + server actions)
src/components     shell (sidebar/topbar/palette) and UI kit
src/lib            auth, permissions, audit, scope, analytics, AI, reports, pdf
src/types/enums.ts single registry of all status values
docs/              architecture, integration contract, Supabase migration, AI boundary
```

## Documentation

- `docs/ARCHITECTURE.md` — how the system is put together and why
- `docs/INTEGRATION.md` — the contract for connecting branch systems
- `docs/SUPABASE_MIGRATION.md` — moving from local SQLite to Supabase (Postgres)
- `docs/GEMMA4_AI.md` — the future AI provider boundary and its rules
- `DESIGN.md` — the Vercel design language reference (installed via `npx getdesign@latest add vercel`)

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm start          # production server
npm run lint       # ESLint (zero errors, zero warnings)
npx tsc --noEmit   # typecheck
npx prisma studio  # inspect the database
```

---

Confidential — management system of Merna Medical Company.
