import { randomUUID } from "node:crypto";
import { db } from "./store";

/**
 * Cross-cutting platform records shared by every module:
 *  - events:  business events queued for the workflow engine (processed by lib/workflows)
 *  - usage:   metered AI credits, voice minutes and WhatsApp messages (Settings → Usage)
 *  - audit:   who did what, for sensitive actions and every AI / automated action
 * This file only depends on the store, so any module can import it without cycles.
 */

let ready = false;
function pdb() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS workflow_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,leadId TEXT,data TEXT NOT NULL,createdAt TEXT NOT NULL,processedAt TEXT);
      CREATE TABLE IF NOT EXISTS usage_records(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,quantity REAL NOT NULL,feature TEXT NOT NULL,detail TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT,entityId TEXT,detail TEXT,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS workflow_queue_open ON workflow_queue(processedAt);
      CREATE INDEX IF NOT EXISTS usage_time ON usage_records(createdAt, kind);
      CREATE INDEX IF NOT EXISTS audit_time ON audit_events(createdAt DESC);`);
    ready = true;
  }
  return c;
}

export type BusinessEvent =
  | "lead.created"
  | "lead.stage_changed"
  | "whatsapp.inbound"
  | "call.completed"
  | "invoice.paid"
  | "quote.accepted";

/** Queue a business event; the workflow engine picks it up within moments. */
export function emit(event: BusinessEvent, leadId: string | null, data: Record<string, unknown> = {}) {
  pdb().prepare("INSERT INTO workflow_queue(event,leadId,data,createdAt) VALUES(?,?,?,?)").run(event, leadId, JSON.stringify(data), new Date().toISOString());
  if (process.env.WORKFLOW_AUTORUN === "0") return;
  setTimeout(() => {
    import("./workflows").then((m) => m.processQueue()).catch((e) => console.error("[workflows] queue failed", e));
  }, 50).unref?.();
}

export function takeEvents(limit = 50) {
  const rows = pdb().prepare("SELECT * FROM workflow_queue WHERE processedAt IS NULL ORDER BY id LIMIT ?").all(limit) as {
    id: number;
    event: BusinessEvent;
    leadId: string | null;
    data: string;
  }[];
  const mark = pdb().prepare("UPDATE workflow_queue SET processedAt=? WHERE id=? AND processedAt IS NULL");
  // Claim each row so two overlapping runs never process the same event.
  return rows.filter((r) => Number(mark.run(new Date().toISOString(), r.id).changes) === 1).map((r) => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> }));
}

export type UsageKind = "ai_credit" | "voice_minute" | "whatsapp_marketing" | "whatsapp_utility" | "whatsapp_service" | "email";

export function meter(kind: UsageKind, quantity: number, feature: string, detail?: Record<string, unknown>) {
  pdb().prepare("INSERT INTO usage_records(kind,quantity,feature,detail,createdAt) VALUES(?,?,?,?,?)").run(kind, quantity, feature, detail ? JSON.stringify(detail) : null, new Date().toISOString());
}

/** Usage totals from `since` up to (not including) `until`. */
export function usageSince(since: string, until = "9999") {
  return pdb().prepare("SELECT kind, feature, SUM(quantity) AS quantity, COUNT(*) AS events FROM usage_records WHERE createdAt>=? AND createdAt<? GROUP BY kind, feature ORDER BY kind").all(since, until) as {
    kind: UsageKind;
    feature: string;
    quantity: number;
    events: number;
  }[];
}

export function usedThisMonth(kind: UsageKind) {
  const start = `${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)}-01`;
  return Number((pdb().prepare("SELECT COALESCE(SUM(quantity),0) AS q FROM usage_records WHERE kind=? AND createdAt>=?").get(kind, start) as { q: number }).q);
}

export function audit(actor: string, action: string, entity?: string | null, entityId?: string | null, detail?: unknown) {
  pdb()
    .prepare("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), actor, action, entity ?? null, entityId ?? null, detail === undefined ? null : JSON.stringify(detail).slice(0, 4000), new Date().toISOString());
}

export function auditLog(limit = 300) {
  return pdb().prepare("SELECT * FROM audit_events ORDER BY createdAt DESC LIMIT ?").all(limit);
}
