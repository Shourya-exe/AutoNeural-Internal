import { createHash, timingSafeEqual } from "node:crypto";
import { allUsers, recordInboundEmail } from "@/lib/store";
import { failure } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound email webhook (Resend Inbound, SendGrid Inbound Parse, a mail-forwarding script…).
 *   POST /api/mail/inbound   Authorization: Bearer <MAIL_INBOUND_SECRET>   (or ?key=<MAIL_INBOUND_SECRET>)
 * Accepts JSON with from/to/subject/text at the top level or under `data`, or a form post.
 * Only messages addressed to a workspace member are stored.
 */
const MAX_BYTES = 2 * 1024 * 1024;

function authorized(req: Request) {
  const secret = process.env.MAIL_INBOUND_SECRET ?? "";
  if (!secret) return false;
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || new URL(req.url).searchParams.get("key") || "";
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

const address = (v: unknown): { email: string; name?: string } | null => {
  if (!v) return null;
  if (Array.isArray(v)) return address(v[0]);
  if (typeof v === "object") {
    const o = v as { email?: unknown; address?: unknown; name?: unknown };
    const email = String(o.email ?? o.address ?? "").trim();
    return email ? { email, name: typeof o.name === "string" ? o.name : undefined } : null;
  }
  const s = String(v).trim();
  const m = s.match(/^(.*)<([^>]+)>\s*$/);
  return m ? { email: m[2].trim(), name: m[1].replace(/"/g, "").trim() || undefined } : s ? { email: s } : null;
};

export async function POST(req: Request) {
  if (!process.env.MAIL_INBOUND_SECRET) return Response.json({ error: "Inbound email is not configured." }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const text = await req.text();
    if (text.length > MAX_BYTES) return Response.json({ error: "Message too large." }, { status: 413 });
    const type = req.headers.get("content-type") ?? "";
    let raw: Record<string, unknown>;
    try {
      raw = type.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text);
    } catch {
      return Response.json({ error: "Send JSON or a form post." }, { status: 400 });
    }
    const src = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
    const from = address(src.fromEmail ?? src.from ?? src.sender);
    const to = address(src.toEmail ?? src.to ?? src.recipient);
    if (!from || !to) return Response.json({ error: "Both from and to email addresses are required." }, { status: 400 });
    if (!allUsers().some((u) => u.email.toLowerCase() === to.email.toLowerCase()))
      return Response.json({ ok: true, ignored: "not addressed to a workspace member" }, { status: 202 });
    const saved = recordInboundEmail({
      fromEmail: from.email,
      fromName: typeof src.fromName === "string" ? src.fromName : from.name,
      toEmail: to.email,
      subject: String(src.subject ?? ""),
      body: String(src.text ?? src.body ?? src.content ?? ""),
      taskId: typeof src.taskId === "string" ? src.taskId : undefined,
    });
    return Response.json({ ok: true, id: saved.id }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
