/**
 * AutoNeural CRM background worker.
 *
 *   npm run worker        # dev (watch)
 *   npm run worker:start  # production
 *
 * Responsibilities:
 *  - Consume the webhook-ingestion queue (durable processing of provider events).
 *  - Run the periodic sweeps on an interval.
 *
 * The sweep logic itself lives in server/services/sweeps.ts and is shared with
 * /api/cron/sweep, so hosts that cannot run a second always-on process (e.g.
 * Hostinger Cloud) get identical behaviour from a scheduler instead. Running
 * both at once is safe — every sweep action is idempotent.
 *
 * Without REDIS_URL the web app processes webhooks inline and this process is
 * only needed for the sweeps.
 */
import "./load-env"; // MUST be first — see the comment in load-env.ts
import { env } from "../lib/env";
import { processWebhookEvent } from "../server/services/ingestion";
import { runSweeps } from "../server/services/sweeps";

const SWEEP_INTERVAL_MS = 60_000;

async function startQueueWorker() {
  if (!env.redisUrl) {
    console.log("[worker] REDIS_URL not set — the web app processes webhooks inline.");
    console.log("[worker] This process will still run the periodic sweeps.");
    return;
  }
  try {
    const IORedis = (await import("ioredis")).default;
    const { Worker } = await import("bullmq");
    const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

    const worker = new Worker(
      "webhook-ingestion",
      async (job) => {
        const { eventId } = job.data as { eventId: string };
        const res = await processWebhookEvent(eventId);
        if (res.status === "failed") throw new Error(res.detail ?? "processing failed");
        return res;
      },
      { connection, concurrency: 8 },
    );

    worker.on("completed", (job, res) =>
      console.log(`[worker] job ${job.id} -> ${JSON.stringify(res)}`),
    );
    worker.on("failed", (job, err) =>
      console.error(`[worker] job ${job?.id} failed: ${err.message}`),
    );
    console.log("[worker] webhook-ingestion worker online (concurrency 8).");
  } catch (e) {
    console.error("[worker] could not start BullMQ worker:", e);
  }
}

async function sweepOnce() {
  try {
    const s = await runSweeps();
    const did = s.drainedEvents + s.retriedEvents;
    if (did || s.errors.length) {
      console.log(
        `[sweep] drained ${s.drainedEvents}, retried ${s.retriedEvents}, ` +
          `no-response ${s.noResponseChecked}, overdue ${s.overdueChecked} (${s.durationMs}ms)`,
      );
    }
    for (const err of s.errors) console.error(`[sweep] ${err}`);
  } catch (e) {
    console.error("[sweep] fatal", e);
  }
}

async function main() {
  await startQueueWorker();
  await sweepOnce();
  setInterval(sweepOnce, SWEEP_INTERVAL_MS);
  console.log(`[worker] periodic sweeps every ${SWEEP_INTERVAL_MS / 1000}s.`);
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
