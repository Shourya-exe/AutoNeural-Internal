/**
 * Local PostgreSQL for development WITHOUT Docker.
 *
 * Uses `embedded-postgres` (real PostgreSQL 17 native binaries) so the app runs
 * against genuine Postgres. Data is stored in ./.localdb so it survives restarts.
 *
 *   node scripts/local-db.mjs           # start and keep running (Ctrl+C to stop)
 *   node scripts/local-db.mjs --stop    # stop a previously started instance
 *
 * Credentials/port match .env.example:
 *   postgresql://autoneural:autoneural@localhost:5432/autoneural_crm
 *
 * In production use a managed PostgreSQL (see DEPLOYMENT.md) — this script is
 * a local convenience only. Prefer `docker compose up -d` if you have Docker.
 */
import EmbeddedPostgres from "embedded-postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", ".localdb");
// Default 55432 to avoid clashing with a system PostgreSQL on 5432.
const PORT = Number(process.env.LOCALDB_PORT ?? 55432);
const USER = "autoneural";
const PASSWORD = "autoneural";
const DB = "autoneural_crm";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  // Force UTF-8. Without this, initdb inherits the Windows ANSI locale
  // (e.g. WIN1252) and any non-Latin-1 character fails to store.
  initdbFlags: ["-E", "UTF8", "--locale=C"],
});

async function main() {
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) {
    console.log("[local-db] initialising cluster in .localdb …");
    await pg.initialise();
  }
  await pg.start();
  console.log(`[local-db] PostgreSQL listening on 127.0.0.1:${PORT}`);

  if (fresh) {
    try {
      await pg.createDatabase(DB);
      console.log(`[local-db] created database "${DB}"`);
    } catch (e) {
      if (!String(e).includes("already exists")) throw e;
    }
  }
  console.log(
    `[local-db] DATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}?schema=public`,
  );
  console.log("[local-db] ready. Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\n[local-db] stopping …");
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  setInterval(() => {}, 1 << 30); // keep alive
}

if (process.argv.includes("--stop")) {
  pg.stop()
    .then(() => console.log("[local-db] stopped"))
    .catch(() => console.log("[local-db] nothing to stop"));
} else {
  main().catch((e) => {
    console.error("[local-db] failed:", e);
    process.exit(1);
  });
}
