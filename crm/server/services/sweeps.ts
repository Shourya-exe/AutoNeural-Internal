import { prisma } from "@/lib/prisma";
import { processWebhookEvent, retryDueWebhookEvents } from "./ingestion";
import { runAutomations } from "./automations";
import { pullLeadSources } from "./lead-sources";

/**
 * Periodic background work, extracted so it has exactly ONE implementation
 * shared by two very different runtimes:
 *
 *   worker/index.ts        long-running process, calls this on an interval
 *   /api/cron/sweep        HTTP endpoint, called by an external scheduler
 *                          (Hostinger Cloud cron, cron-job.org, GitHub Actions)
 *
 * Everything here is DB-backed and idempotent, so it survives restarts and is
 * safe to run twice concurrently: automations dedupe on (ruleId, dedupeKey) and
 * event processing dedupes on the provider event / message id.
 */

export interface SweepSummary {
  organizations: number;
  drainedEvents: number;
  retriedEvents: number;
  noResponseChecked: number;
  overdueChecked: number;
  durationMs: number;
  errors: string[];
}

/**
 * Pick up events that were persisted but never processed.
 *
 * Needed when there is no Redis queue (the web request processes inline, and an
 * inline failure or a process restart mid-request would otherwise strand the
 * event) and as a safety net when there is.
 */
async function drainStuckEvents(limit = 50): Promise<number> {
  // RECEIVED = never picked up. PROCESSING older than 5 minutes = a worker died
  // mid-flight; processWebhookEvent is idempotent so re-running is safe.
  const stalledBefore = new Date(Date.now() - 5 * 60_000);
  const stuck = await prisma.webhookEvent.findMany({
    where: {
      OR: [
        { status: "RECEIVED" },
        { status: "PROCESSING", receivedAt: { lt: stalledBefore } },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const e of stuck) await processWebhookEvent(e.id);
  return stuck.length;
}

export async function runSweeps(): Promise<SweepSummary> {
  const startedAt = Date.now();
  const now = new Date();
  const errors: string[] = [];

  let drainedEvents = 0;
  let retriedEvents = 0;
  let noResponseChecked = 0;
  let overdueChecked = 0;

  // Event processing is organization-agnostic — do it once, not per org.
  try {
    drainedEvents = await drainStuckEvents(50);
  } catch (e) {
    errors.push(`drain: ${msg(e)}`);
  }
  try {
    retriedEvents = await retryDueWebhookEvents(25);
  } catch (e) {
    errors.push(`retry: ${msg(e)}`);
  }

  const orgs = await prisma.organization.findMany();

  for (const org of orgs) {
    // ── Automatic lead sources (sheet/CSV feeds, IndiaMART); each self-throttles ──
    try {
      for (const err of await pullLeadSources(org.id, now)) errors.push(`lead-source(${org.slug}): ${err}`);
    } catch (e) {
      errors.push(`lead-sources(${org.slug}): ${msg(e)}`);
    }

    // ── No first human response within the SLA ──
    try {
      const cutoff = new Date(now.getTime() - org.noResponseSlaMins * 60_000);
      const awaiting = await prisma.lead.findMany({
        where: {
          organizationId: org.id,
          status: "OPEN",
          archivedAt: null,
          firstResponseAt: null,
          firstInboundAt: { not: null, lte: cutoff },
        },
        select: { id: true },
        take: 200,
      });
      noResponseChecked += awaiting.length;
      // One reminder per lead per SLA-length bucket, so a sweep running every
      // minute does not produce a reminder every minute.
      const bucket = Math.floor(now.getTime() / (org.noResponseSlaMins * 60_000));
      for (const l of awaiting) {
        await runAutomations({
          organizationId: org.id,
          trigger: "NO_RESPONSE",
          leadId: l.id,
          dedupeSuffix: `noresp:${bucket}`,
        });
      }
    } catch (e) {
      errors.push(`no-response(${org.slug}): ${msg(e)}`);
    }

    // ── Overdue follow-ups ──
    try {
      const overdue = await prisma.lead.findMany({
        where: {
          organizationId: org.id,
          status: "OPEN",
          archivedAt: null,
          nextFollowUpAt: { not: null, lt: now },
        },
        select: { id: true },
        take: 200,
      });
      overdueChecked += overdue.length;
      // One escalation per lead per day.
      const day = now.toISOString().slice(0, 10);
      for (const l of overdue) {
        await runAutomations({
          organizationId: org.id,
          trigger: "FOLLOW_UP_OVERDUE",
          leadId: l.id,
          dedupeSuffix: `overdue:${day}`,
        });
      }
    } catch (e) {
      errors.push(`overdue(${org.slug}): ${msg(e)}`);
    }
  }

  return {
    organizations: orgs.length,
    drainedEvents,
    retriedEvents,
    noResponseChecked,
    overdueChecked,
    durationMs: Date.now() - startedAt,
    errors,
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
