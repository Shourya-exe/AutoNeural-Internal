import { createHash, timingSafeEqual } from "node:crypto";

/** Machine-to-machine auth for the voice worker: `Authorization: Bearer <AGENT_INGEST_SECRET>`. */
export function agentAuthorized(req: Request) {
  const secret = process.env.AGENT_INGEST_SECRET ?? "";
  if (!secret) return false;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
