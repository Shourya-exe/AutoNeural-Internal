import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { runSweeps } from "@/server/services/sweeps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduler-driven background work, for hosts that cannot run a second
 * always-on process (Hostinger Cloud, most managed Node hosting).
 *
 *   * * * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
 *               https://crm.autoneural.in/api/cron/sweep
 *
 * Does exactly what the long-running worker's periodic sweep does — drains
 * stranded webhook events, retries failed ones, sends no-response reminders and
 * escalates overdue follow-ups. Everything is idempotent, so running this and
 * the worker at the same time is harmless.
 *
 * Auth: a shared secret in `x-cron-secret` (or `Authorization: Bearer <secret>`).
 * Fails CLOSED — with no CRON_SECRET configured the endpoint is disabled rather
 * than open. It is exempt from the site-wide Basic-Auth wall because a cron job
 * cannot answer a browser password prompt; this secret replaces it.
 */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const configured = process.env.CRON_SECRET ?? "";

  if (!configured) {
    return NextResponse.json(
      {
        error: "Cron endpoint is disabled.",
        hint: "Set CRON_SECRET to enable scheduler-driven sweeps.",
      },
      { status: 503 },
    );
  }

  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!timingSafeEqual(provided, configured)) {
    // Deliberately terse — do not tell a prober whether the secret was close.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runSweeps();
    const status = summary.errors.length ? 207 : 200;
    return NextResponse.json({ ok: summary.errors.length === 0, ...summary }, { status });
  } catch (e) {
    console.error("[cron/sweep] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Sweep failed" },
      { status: 500 },
    );
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  // Hash both sides first so the comparison is constant-time even when the
  // lengths differ (timingSafeEqual throws on a length mismatch).
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
