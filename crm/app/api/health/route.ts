import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isRedisAvailable } from "@/server/queue/queues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, unknown> = {
    app: "ok",
    demoMode: env.demoMode,
    displayTimezone: env.displayTimezone,
    aiEnabled: env.ai.enabled,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (e) {
    checks.database = "unreachable";
  }

  try {
    checks.queue = (await isRedisAvailable()) ? "redis" : "inline-fallback";
  } catch {
    checks.queue = "inline-fallback";
  }

  const healthy = checks.database === "ok";
  return NextResponse.json({ status: healthy ? "healthy" : "degraded", checks }, {
    status: healthy ? 200 : 503,
  });
}
