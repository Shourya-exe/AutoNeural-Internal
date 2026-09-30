/** Node.js server startup: configuration checks, database, and the background minute loop. */
import { configReport } from "./lib/config";
import { db } from "./lib/store";
import { pullLeadSources } from "./lib/leads";
import { retryFacebookLeads } from "./lib/facebook";
import { rerouteLeadsOnLeave } from "./lib/hr";
import { processQueue } from "./lib/workflows";

const { errors, warnings } = configReport();
for (const e of errors) console.error(`[config] ${e}`);
for (const w of warnings) console.warn(`[config] ${w}`);

// Open (and migrate) the database at startup rather than on the first request.
db();
// Next.js drains in-flight requests on SIGTERM/SIGINT and then exits; close SQLite cleanly
// so the WAL is checkpointed.
process.once("exit", () => {
  try {
    db().close();
  } catch {}
});

// Pull Google Sheet / IndiaMART leads every minute while the server runs
// (each source throttles itself). Hostinger may idle-stop the app, so a cron on
// GET /api/leads/intake keeps pulls going when nobody has the app open.
setInterval(() => {
  void pullLeadSources().catch((e) => console.error("[leads] pull failed", e));
  void retryFacebookLeads().catch((e) => console.error("[facebook] retry failed", e)); // leads Meta sent but we couldn't read yet
  void processQueue().catch((e) => console.error("[workflows] tick failed", e)); // resumes waiting runs
  try {
    rerouteLeadsOnLeave(); // new leads never wait on someone who is on leave today
  } catch (e) {
    console.error("[hr] re-route failed", e);
  }
}, 60_000).unref();
