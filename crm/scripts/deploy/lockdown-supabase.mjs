/**
 * Supabase PostgREST lockdown on its own (the same step bootstrap-production.mjs runs), for
 * databases filled by the demo seed instead of the bootstrap: RLS on every public table with
 * zero policies, and no anon/authenticated grants. The app's own login owns the tables and
 * is unaffected.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

await prisma.$executeRawUnsafe(`
  DO $$
  DECLARE t text;
  BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
  END $$;
`);
for (const stmt of [
  "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated",
  "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated",
  "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated",
]) {
  await prisma.$executeRawUnsafe(stmt);
}
const [r] = await prisma.$queryRawUnsafe(`
  SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS total,
         (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND rowsecurity) AS secured,
         (SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema='public' AND grantee IN ('anon','authenticated')) AS anon_grants`);
console.log(`lockdown: RLS on ${r.secured}/${r.total} tables, ${r.anon_grants} anon/authenticated grants`);
await prisma.$disconnect();
