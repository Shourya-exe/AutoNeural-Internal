import { accessSync, constants, mkdirSync } from "node:fs";
import { db, setupRequired } from "@/lib/store";
import { uploadDir } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + readiness for load balancers and uptime monitors. Reveals no configuration details. */
export function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    db().prepare("SELECT 1").get();
  } catch (e) {
    console.error("[health] database check failed", e);
    return Response.json({ status: "error", database: "unavailable" }, { status: 503, headers });
  }
  let uploads = "ok";
  try {
    mkdirSync(uploadDir(), { recursive: true });
    accessSync(uploadDir(), constants.W_OK);
  } catch {
    uploads = "not writable";
  }
  return Response.json(
    { status: uploads === "ok" ? "ok" : "degraded", database: "ok", uploads, setupRequired: setupRequired(), time: new Date().toISOString() },
    { headers },
  );
}
