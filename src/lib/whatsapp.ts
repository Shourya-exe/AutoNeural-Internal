import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, allUsers } from "./store";
import { addLeads, ldb, normalizePhone } from "./leads";
import { audit, emit, meter } from "./platform";
import type { User } from "./types";

/**
 * WhatsApp shared inbox on the official Meta Cloud API.
 *
 * Inbound: Meta → /api/whatsapp/webhook (X-Hub-Signature-256 verified) → conversation +
 * message stored → unknown numbers become leads → workflow event → optional AI agent reply.
 * Outbound: free-form text only inside the 24-hour customer-service window; outside it an
 * approved template is required. "STOP" opts the customer out of all business-initiated sends.
 * Meta charges are metered per category (Settings → Usage) — never presented as free.
 */

export type Conversation = {
  id: string;
  phone: string;
  name: string;
  leadId: string | null;
  leadStatus: string | null;
  ownerName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: "open" | "closed";
  aiMode: number;
  unread: number;
  lastMessageAt: string;
  lastInboundAt: string | null;
  lastText: string | null;
  optOut: number;
};
export type Message = { id: string; direction: "in" | "out"; body: string; type: string; status: string; sender: string | null; error: string | null; createdAt: string };

let ready = false;
export function wdb() {
  const c = ldb();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS wa_conversations(id TEXT PRIMARY KEY,phone TEXT UNIQUE NOT NULL,name TEXT NOT NULL,leadId TEXT REFERENCES leads(id) ON DELETE SET NULL,assigneeId TEXT REFERENCES users(id),status TEXT NOT NULL DEFAULT 'open',aiMode INTEGER NOT NULL DEFAULT 1,unread INTEGER NOT NULL DEFAULT 0,lastMessageAt TEXT NOT NULL,lastInboundAt TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wa_messages(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,waId TEXT UNIQUE,direction TEXT NOT NULL CHECK(direction IN ('in','out')),type TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,sender TEXT,error TEXT,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wa_messages_conv ON wa_messages(conversationId, createdAt);
      CREATE INDEX IF NOT EXISTS wa_conv_time ON wa_conversations(lastMessageAt DESC);`);
    ready = true;
  }
  return c;
}
const now = () => new Date().toISOString();
export const waConfigured = () => !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
export const windowOpen = (lastInboundAt: string | null) => !!lastInboundAt && Date.now() - Date.parse(lastInboundAt) < 24 * 3600_000;

// ─── Webhook ─────────────────────────────────────────────────────────────────

/** Meta's GET handshake (shared by every Meta webhook; Facebook Lead Ads passes its own token). */
export function verifySubscription(q: URLSearchParams, token = process.env.WHATSAPP_VERIFY_TOKEN) {
  if (q.get("hub.mode") === "subscribe" && token && q.get("hub.verify_token") === token) return q.get("hub.challenge") ?? "";
  return null;
}

/** X-Hub-Signature-256: HMAC of the raw body with the Meta app secret. */
export function verifySignature(raw: string, header: string | null, secret = process.env.WHATSAPP_APP_SECRET) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const a = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const b = Buffer.from(header.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}

type WaValue = {
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: { from: string; id: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }; image?: { caption?: string }; document?: { filename?: string } }[];
  statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
};

/** Processes a verified Meta webhook body. Returns the conversations that got new inbound messages. */
export function handleWebhook(body: { entry?: { changes?: { value?: WaValue }[] }[] }) {
  const touched: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const m of v.messages ?? []) {
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const text =
          m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? (m.document ? `[document] ${m.document.filename ?? ""}` : `[${m.type}]`);
        const id = ingestInbound({ phone: m.from, name, waId: m.id, type: m.type, text, at: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString() });
        if (id) touched.push(id);
      }
      for (const s of v.statuses ?? []) {
        const error = s.errors?.[0] ? `${s.errors[0].title ?? ""} ${s.errors[0].message ?? ""}`.trim() : null;
        // Statuses can arrive out of order; never downgrade read → delivered.
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const cur = wdb().prepare("SELECT status FROM wa_messages WHERE waId=?").get(s.id) as { status: string } | undefined;
        if (cur && (rank[s.status] ?? 0) > (rank[cur.status] ?? 0)) wdb().prepare("UPDATE wa_messages SET status=?, error=? WHERE waId=?").run(s.status, error, s.id);
      }
    }
  }
  return [...new Set(touched)];
}

export function ingestInbound(m: { phone: string; name?: string; waId: string; type: string; text: string; at?: string }) {
  const db = wdb();
  if (db.prepare("SELECT 1 FROM wa_messages WHERE waId=?").get(m.waId)) return null; // Meta retries webhooks
  const phone = normalizePhone(m.phone) ?? `+${m.phone.replace(/\D/g, "")}`;
  const at = m.at ?? now();
  let conv = db.prepare("SELECT * FROM wa_conversations WHERE phone=?").get(phone) as Record<string, any> | undefined;
  if (!conv) {
    let lead = db.prepare("SELECT id FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1").get(phone) as { id: string } | undefined;
    if (!lead) {
      const id = addLeads([{ externalId: `wa:${phone}`, name: m.name || phone, phone, message: m.text, sourceDetail: "WhatsApp enquiry" }], "WhatsApp").leadIds[0];
      lead = id ? { id } : (db.prepare("SELECT id FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1").get(phone) as { id: string } | undefined);
    }
    const owner = lead ? (db.prepare("SELECT ownerId FROM leads WHERE id=?").get(lead.id) as { ownerId: string | null }).ownerId : null;
    const aiDefault = (agentSettings().enabled ? 1 : 0);
    db.prepare("INSERT INTO wa_conversations(id,phone,name,leadId,assigneeId,aiMode,lastMessageAt,createdAt) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), phone, m.name || phone, lead?.id ?? null, owner, aiDefault, at, now());
    conv = db.prepare("SELECT * FROM wa_conversations WHERE phone=?").get(phone) as Record<string, any>;
  }
  db.prepare("INSERT INTO wa_messages(id,conversationId,waId,direction,type,body,status,sender,createdAt) VALUES(?,?,?,'in',?,?,'received',NULL,?)").run(randomUUID(), conv.id, m.waId, m.type, m.text.slice(0, 4096), at);
  db.prepare("UPDATE wa_conversations SET lastMessageAt=?, lastInboundAt=?, unread=unread+1, status='open', name=CASE WHEN name=phone AND ? IS NOT NULL THEN ? ELSE name END WHERE id=?").run(at, at, m.name ?? null, m.name ?? null, conv.id);
  if (/^\s*(stop|unsubscribe|opt ?out)\s*$/i.test(m.text) && conv.leadId) {
    db.prepare("UPDATE leads SET optOut=1 WHERE id=?").run(conv.leadId);
    db.prepare("UPDATE wa_conversations SET aiMode=0 WHERE id=?").run(conv.id);
    audit("customer", "whatsapp.opt_out", "lead", conv.leadId, { phone });
  } else if (/^\s*(start|subscribe)\s*$/i.test(m.text) && conv.leadId) {
    db.prepare("UPDATE leads SET optOut=0 WHERE id=?").run(conv.leadId);
    audit("customer", "whatsapp.opt_in", "lead", conv.leadId, { phone });
  }
  emit("whatsapp.inbound", conv.leadId, { text: m.text, conversationId: conv.id });
  return conv.id as string;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

async function graphSend(payload: Record<string, unknown>) {
  if (!waConfigured()) throw new AppError(400, "WhatsApp is not connected (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID).");
  const res = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !j.messages?.[0]?.id) throw new AppError(502, `WhatsApp: ${j.error?.message ?? `HTTP ${res.status}`}`);
  return j.messages[0].id;
}

function conversationFor(user: User | null, id: string) {
  const c = wdb().prepare("SELECT c.*, l.ownerId, l.optOut FROM wa_conversations c LEFT JOIN leads l ON l.id=c.leadId WHERE c.id=?").get(id) as Record<string, any> | undefined;
  if (!c || (user && user.role !== "admin" && c.assigneeId && c.assigneeId !== user.id && c.ownerId !== user.id)) throw new AppError(404, "Conversation not found.");
  return c;
}

function storeOut(conversationId: string, waId: string | null, type: string, body: string, sender: string, error: string | null = null) {
  wdb()
    .prepare("INSERT INTO wa_messages(id,conversationId,waId,direction,type,body,status,sender,error,createdAt) VALUES(?,?,?,'out',?,?,?,?,?,?)")
    .run(randomUUID(), conversationId, waId, type, body.slice(0, 4096), error ? "failed" : "sent", sender, error, now());
  wdb().prepare("UPDATE wa_conversations SET lastMessageAt=? WHERE id=?").run(now(), conversationId);
}

/** Free-form reply inside the 24-hour window. A human reply takes the conversation over from the AI agent. */
export async function sendText(user: User | null, conversationId: string, text: string, sender = user?.name ?? "AutoNeural") {
  const body = z.string().trim().min(1).max(4000).parse(text);
  const c = conversationFor(user, conversationId);
  if (!windowOpen(c.lastInboundAt)) throw new AppError(400, "The 24-hour window is closed. Send an approved template instead.");
  const waId = await graphSend({ to: c.phone.replace(/\D/g, ""), type: "text", text: { body, preview_url: false } });
  storeOut(c.id, waId, "text", body, sender);
  meter("whatsapp_service", 1, user ? "inbox" : "ai_agent");
  if (user) {
    wdb().prepare("UPDATE wa_conversations SET aiMode=0, unread=0, assigneeId=coalesce(assigneeId, ?) WHERE id=?").run(user.id, c.id);
  }
  return { ok: true };
}

/** Approved template to a conversation or a bare number (campaigns, workflows, first contact). */
export async function sendTemplate(
  user: User | null,
  target: { conversationId?: string; phone?: string; name?: string; leadId?: string | null },
  template: string,
  opts: { language?: string; params?: string[]; category?: "marketing" | "utility" } = {},
) {
  const [name, langFromName] = template.split(":");
  const phone = target.conversationId ? conversationFor(user, target.conversationId).phone : normalizePhone(target.phone);
  if (!phone) throw new AppError(400, "No valid phone number.");
  const lead = wdb().prepare("SELECT id, optOut FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1").get(phone) as { id: string; optOut: number } | undefined;
  if (lead?.optOut) throw new AppError(409, "This customer opted out of WhatsApp messages.");
  const waId = await graphSend({
    to: phone.replace(/\D/g, ""),
    type: "template",
    template: {
      name,
      language: { code: opts.language || langFromName || process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
      ...(opts.params?.length ? { components: [{ type: "body", parameters: opts.params.map((text) => ({ type: "text", text })) }] } : {}),
    },
  });
  let conv = wdb().prepare("SELECT id FROM wa_conversations WHERE phone=?").get(phone) as { id: string } | undefined;
  if (!conv) {
    const id = randomUUID();
    wdb().prepare("INSERT INTO wa_conversations(id,phone,name,leadId,assigneeId,aiMode,lastMessageAt,createdAt) VALUES(?,?,?,?,?,?,?,?)").run(id, phone, target.name || phone, lead?.id ?? target.leadId ?? null, user?.id ?? null, agentSettings().enabled ? 1 : 0, now(), now());
    conv = { id };
  }
  storeOut(conv.id, waId, "template", `[template ${name}]${opts.params?.length ? ` ${opts.params.join(" · ")}` : ""}`, user?.name ?? "Automation");
  meter(opts.category === "marketing" ? "whatsapp_marketing" : "whatsapp_utility", 1, user ? "inbox" : "automation", { template: name });
  return { ok: true, conversationId: conv.id };
}

// ─── Inbox views ─────────────────────────────────────────────────────────────

export function listConversations(user: User, filter: "all" | "mine" | "unassigned" | "ai" | "closed" = "all", q = "") {
  const admin = user.role === "admin";
  const rows = wdb()
    .prepare(
      `SELECT c.*, l.status AS leadStatus, l.optOut, o.name AS ownerName, a.name AS assigneeName,
        (SELECT body FROM wa_messages m WHERE m.conversationId=c.id ORDER BY createdAt DESC LIMIT 1) AS lastText
       FROM wa_conversations c LEFT JOIN leads l ON l.id=c.leadId LEFT JOIN users o ON o.id=l.ownerId LEFT JOIN users a ON a.id=c.assigneeId
       ORDER BY c.lastMessageAt DESC LIMIT 300`,
    )
    .all() as unknown as (Conversation & { ownerId?: string })[];
  return rows.filter(
    (c) =>
      (admin || !c.assigneeId || c.assigneeId === user.id) &&
      (filter === "all" ? c.status === "open" : filter === "closed" ? c.status === "closed" : filter === "mine" ? c.assigneeId === user.id && c.status === "open" : filter === "unassigned" ? !c.assigneeId && c.status === "open" : c.aiMode === 1 && c.status === "open") &&
      (!q || `${c.name} ${c.phone} ${c.lastText ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  );
}

export function thread(user: User, id: string) {
  const c = conversationFor(user, id);
  wdb().prepare("UPDATE wa_conversations SET unread=0 WHERE id=?").run(id);
  const messages = wdb().prepare("SELECT id,direction,body,type,status,sender,error,createdAt FROM wa_messages WHERE conversationId=? ORDER BY createdAt").all(id) as unknown as Message[];
  return { conversation: { ...c, windowOpen: windowOpen(c.lastInboundAt) } as Record<string, any> & { windowOpen: boolean }, messages };
}

export function updateConversation(user: User, input: unknown) {
  const p = z
    .object({ id: z.string().uuid(), assigneeId: z.string().uuid().nullable().optional(), aiMode: z.boolean().optional(), status: z.enum(["open", "closed"]).optional() })
    .parse(input);
  const c = conversationFor(user, p.id);
  if (p.assigneeId !== undefined && user.role !== "admin" && p.assigneeId !== user.id) throw new AppError(403, "You can only take conversations yourself.");
  if (p.assigneeId && !allUsers().some((u) => u.id === p.assigneeId)) throw new AppError(404, "Teammate not found.");
  wdb()
    .prepare("UPDATE wa_conversations SET assigneeId=?, aiMode=?, status=? WHERE id=?")
    .run(p.assigneeId === undefined ? c.assigneeId : p.assigneeId, p.aiMode === undefined ? c.aiMode : p.aiMode ? 1 : 0, p.status ?? c.status, p.id);
  audit(user.name, "whatsapp.conversation.update", "conversation", p.id, p);
  return { ok: true };
}

// ─── AI agent settings (approved knowledge boundary) ─────────────────────────

export const agentSchema = z.object({
  enabled: z.boolean(),
  knowledge: z.string().max(20_000),
  maxRepliesPerDay: z.number().int().min(1).max(50),
  handoffOnInterest: z.boolean(),
});
export type AgentSettings = z.infer<typeof agentSchema>;
export function agentSettings(): AgentSettings {
  const row = ldb().prepare("SELECT value FROM settings WHERE key='wa_agent'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as AgentSettings) : { enabled: false, knowledge: "", maxRepliesPerDay: 8, handoffOnInterest: true };
}
export function saveAgentSettings(user: User, input: unknown) {
  if (user.role !== "admin") throw new AppError(403, "Only admins can configure the AI agent.");
  const p = agentSchema.parse(input);
  ldb().prepare("INSERT INTO settings(key,value) VALUES('wa_agent',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(p));
  audit(user.name, "whatsapp.agent.settings", null, null, { enabled: p.enabled, maxRepliesPerDay: p.maxRepliesPerDay });
}
