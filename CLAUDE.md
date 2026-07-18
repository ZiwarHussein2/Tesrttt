# Merna Control Center — agent notes

Real production management system for Merna Medical Company (not a demo; no mock data).
Next.js 16 App Router + TypeScript + Tailwind v4 + Prisma 6/SQLite (Postgres-portable).

## Commands
- `npm run dev` / `npm run build` / `npm start` (set `PORT`)
- `npm run lint` and `npx tsc --noEmit` must stay clean (zero warnings)
- DB: `npx prisma migrate dev`; reset requires a server restart (open file handle)

## Hard rules
- Every figure comes from `src/lib/analytics/metrics.ts` — never re-implement an aggregation.
- Every mutation: server action + `guardWrite(module)` + `branchAllowed()` + `logAudit()`.
- `AuditEvent` is append-only; never add update/delete paths.
- Status values live only in `src/types/enums.ts` (SQLite has no enums).
- No external AI calls/keys — Merna AI stays behind `MernaAIProvider` (see docs/GEMMA4_AI.md).
- Sensitive data is masked per role via `maskingFor()` — respect it in any new UI.
- English only; Vercel design language (DESIGN.md); no dead buttons or placeholder pages.

## Layout
- Pages: `src/app/(app)/<module>/page.tsx` (server components, URL-driven tables/filters)
- Mutations: sibling `actions.ts`; dialogs via `ActionDialog`/`ActionButton` (`src/components/ui/dialog.tsx`)
- Money: whole IQD stored as Float (exact < 2^53); format with `fmtIQD*`
