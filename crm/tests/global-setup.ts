/**
 * Creates (or reuses) a dedicated TEST database on the same PostgreSQL server
 * as DATABASE_URL, then applies the Prisma migrations to it.
 *
 * Requires a running PostgreSQL. For local dev: `npm run db:local`
 * (embedded PostgreSQL 17, no Docker needed) or `docker compose up -d`.
 */
import { execSync } from "node:child_process";
import { Client } from "pg";

try {
  (process as any).loadEnvFile?.();
} catch {
  /* env may come from the ambient environment */
}

export default async function setup() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set — start a database and configure .env");

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, "").split("?")[0];
  const testDbName = `${dbName}_test`;

  // 1. Ensure the test database exists (connect to the default `postgres` db).
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDbName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${testDbName}"`);
    console.log(`[tests] created database ${testDbName}`);
  }
  await admin.end();

  // 2. Point everything at the test database and apply migrations.
  const testUrl = new URL(base);
  testUrl.pathname = `/${testDbName}`;
  process.env.DATABASE_URL = testUrl.toString();
  process.env.TEST_DATABASE_URL = testUrl.toString();
  process.env.DEMO_MODE = "false"; // tests exercise the real gating logic

  // DIRECT_URL must be overridden too. The schema declares `directUrl`, and
  // `prisma migrate deploy` PREFERS it over `url` — so leaving the value from
  // .env in place would migrate the developer's real database instead of the
  // test one. Locally both endpoints are the same host, so reusing testUrl is
  // correct; a pooled production DIRECT_URL is never involved in tests.
  process.env.DIRECT_URL = testUrl.toString();

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      DIRECT_URL: testUrl.toString(),
    },
  });

  return async () => {
    /* keep the test database around for faster reruns */
  };
}
