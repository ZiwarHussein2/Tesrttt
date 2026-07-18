# Migrating to Supabase (PostgreSQL)

The system runs on local SQLite today. The schema was written to be Postgres-portable:
no SQLite-specific features, string-based enums validated in `src/types/enums.ts`, and money
stored as whole IQD amounts.

## Steps

1. **Create the Supabase project** and copy its Postgres connection string (use the pooled
   connection for the app and the direct connection for migrations).

2. **Switch the datasource** in `prisma/schema.prisma`:

   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")        // pooled (pgbouncer) URL
     directUrl = env("DIRECT_URL")          // direct URL for migrations
   }
   ```

3. **Regenerate migrations for Postgres.** The existing migration history is SQLite SQL, so
   create a fresh baseline:

   ```bash
   rm -rf prisma/migrations
   npx prisma migrate dev --name init-postgres
   ```

4. **Move the data.** Export from SQLite and import into Postgres. The simplest reliable path
   is a small script using two Prisma clients (old SQLite datasource → new Postgres), copying
   tables in dependency order:
   `Company → Branch → Department → Machine/Service/PricingWindow → Employee → User/Session →
   Patient → Visit → IncomeEntry/Expense/... → InventoryItem → InventoryMovement →
   Alert/Incident/AuditEvent/...`
   Copy `AuditEvent` last and verify row counts match.

5. **Optional hardening on Postgres:**
   - Convert money columns from `DOUBLE PRECISION` to `BIGINT` (whole IQD) or `NUMERIC(18,0)`.
   - Convert string-enum columns to native Postgres enums (values are listed in
     `src/types/enums.ts`).
   - Add Row-Level Security policies mirroring `src/lib/permissions.ts` (branch isolation for
     branch-scoped users) for defense in depth. The application already enforces this at the
     query layer.

6. **Environment:** set `DATABASE_URL`, `DIRECT_URL` and a strong `AUTH_SECRET` in the deploy
   environment. Nothing else changes — no application code depends on SQLite.

7. **Later, optionally adopt Supabase Auth** in place of the built-in credentials system.
   The `User` model keeps its role/branch fields; only `auth.ts` (session issuing/verification)
   would be replaced, and `requireUser`/`guardWrite` remain the enforcement points.
