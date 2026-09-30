import { env } from "@/lib/env";
import type { Queue as BullQueue } from "bullmq";

/**
 * BullMQ queues with an INLINE fallback.
 *
 * If REDIS_URL is set the webhook route enqueues a job and returns immediately;
 * the worker process (npm run worker) consumes it. If Redis is absent/unreachable
 * the same work runs inline in the request (clearly logged) so the whole
 * ingestion path still functions for local evaluation.
 */

export const QUEUE_NAMES = {
  webhook: "webhook-ingestion",
  scheduler: "scheduler",
} as const;

let _connection: any = null;
let _queues: Record<string, BullQueue> | null = null;
let _redisTried = false;

async function getConnection() {
  if (!env.redisUrl) return null;
  if (_connection) return _connection;
  if (_redisTried) return _connection;
  _redisTried = true;
  try {
    const IORedis = (await import("ioredis")).default;
    const conn = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    await conn.connect();
    _connection = conn;
    return conn;
  } catch (e) {
    console.warn(
      "[queue] Redis unavailable — falling back to INLINE processing. (%s)",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export async function getQueues(): Promise<Record<string, BullQueue> | null> {
  const conn = await getConnection();
  if (!conn) return null;
  if (_queues) return _queues;
  const { Queue } = await import("bullmq");
  _queues = {
    [QUEUE_NAMES.webhook]: new Queue(QUEUE_NAMES.webhook, { connection: conn }),
    [QUEUE_NAMES.scheduler]: new Queue(QUEUE_NAMES.scheduler, { connection: conn }),
  };
  return _queues;
}

export async function enqueueWebhookProcessing(eventId: string): Promise<"queued" | "inline"> {
  const queues = await getQueues();
  if (queues) {
    await queues[QUEUE_NAMES.webhook].add(
      "process",
      { eventId },
      {
        jobId: `evt:${eventId}`, // dedupe identical enqueues
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    return "queued";
  }
  // Inline fallback — import lazily to avoid pulling worker code into edge.
  const { processWebhookEvent } = await import("@/server/services/ingestion");
  await processWebhookEvent(eventId).catch((e) =>
    console.error("[queue:inline] processing failed", e),
  );
  return "inline";
}

export async function isRedisAvailable(): Promise<boolean> {
  return (await getConnection()) !== null;
}
