import { AppError } from "./store";
import { ldb } from "./leads";
import { sdb } from "./sales";
import { cdb } from "./voice";
import { wdb } from "./whatsapp";
import type { User } from "./types";

/**
 * Customer 360: one time-ordered timeline for a lead across every module —
 * WhatsApp, AI and human calls, notes and task activity, meetings, quotations,
 * invoices, payments and grievances.
 */
export type TimelineItem = { at: string; kind: string; title: string; detail?: string | null; by?: string | null; link?: string | null };

export function timeline(user: User, leadId: string) {
  sdb();
  cdb();
  wdb();
  const db = ldb();
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(leadId) as Record<string, any> | undefined;
  if (!lead || (user.role !== "admin" && lead.ownerId !== user.id)) throw new AppError(404, "Lead not found.");
  const items: TimelineItem[] = [{ at: lead.createdAt, kind: "lead", title: `Lead captured from ${lead.sourceDetail || lead.source}`, detail: lead.message }];
  const q = <T>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];
  for (const m of q<{ direction: string; body: string; sender: string | null; createdAt: string; status: string }>(
    "SELECT m.direction, m.body, m.sender, m.createdAt, m.status FROM wa_messages m JOIN wa_conversations c ON c.id=m.conversationId WHERE c.leadId=? ORDER BY m.createdAt DESC LIMIT 200",
    leadId,
  ))
    items.push({ at: m.createdAt, kind: "whatsapp", title: m.direction === "in" ? "WhatsApp from customer" : `WhatsApp by ${m.sender ?? "team"} · ${m.status}`, detail: m.body });
  for (const c of q<Record<string, any>>("SELECT c.*, u.name AS who FROM calls c LEFT JOIN users u ON u.id=coalesce(c.userId,c.requestedBy) WHERE c.leadId=? ORDER BY c.createdAt DESC", leadId))
    items.push({
      at: c.endedAt ?? c.createdAt,
      kind: "call",
      title: `${c.agent === "human" ? "Call" : "AI call"} (${c.direction}) · ${c.disposition ?? c.status}${c.duration ? ` · ${Math.round(c.duration / 60)} min` : ""}`,
      detail: [c.summary, c.nextAction && `Next: ${c.nextAction}`].filter(Boolean).join("\n") || c.notes,
      by: c.who,
      link: c.recordingUrl,
    });
  if (lead.taskId) {
    for (const c of q<{ text: string; createdAt: string; name: string }>("SELECT c.text, c.createdAt, u.name FROM comments c JOIN users u ON u.id=c.actorId WHERE c.taskId=?", lead.taskId))
      if (!/^(AI (inbound|outbound) call|Call \(|Cloud call|WhatsApp AI:)/.test(c.text)) items.push({ at: c.createdAt, kind: "note", title: "Note", detail: c.text, by: c.name });
  }
  for (const t of q<{ title: string; status: string; dueDate: string; createdAt: string }>("SELECT title, status, dueDate, createdAt FROM tasks WHERE id=?", lead.taskId ?? ""))
    items.push({ at: t.createdAt, kind: "task", title: `Task: ${t.title}`, detail: `${t.status} · due ${t.dueDate}` });
  for (const m of q<Record<string, any>>("SELECT * FROM meetings WHERE leadId=?", leadId))
    items.push({ at: m.createdAt, kind: "meeting", title: `Meeting: ${m.title}`, detail: new Date(m.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), link: m.link });
  for (const d of q<Record<string, any>>("SELECT * FROM documents WHERE leadId=?", leadId)) {
    items.push({ at: d.createdAt, kind: d.kind, title: `${d.kind === "quote" ? "Quotation" : "Invoice"} ${d.number} · ₹${Number(d.total).toLocaleString("en-IN")} · ${d.status}`, link: `/d/${d.token}` });
    for (const p of q<Record<string, any>>("SELECT * FROM payments WHERE documentId=?", d.id))
      items.push({ at: p.paidAt, kind: "payment", title: `Payment ₹${Number(p.amount).toLocaleString("en-IN")} via ${p.method}`, detail: p.reference });
  }
  for (const t of q<Record<string, any>>("SELECT * FROM tickets WHERE leadId=?", leadId))
    items.push({ at: t.createdAt, kind: "ticket", title: `Grievance #${t.number}: ${t.subject} · ${t.status}`, detail: t.description });
  items.sort((a, b) => b.at.localeCompare(a.at));
  const next =
    lead.status === "Won" || lead.status === "Lost"
      ? null
      : lead.nextFollowUp
        ? `Follow up on ${lead.nextFollowUp}`
        : items.some((i) => i.kind === "call" || i.kind === "whatsapp")
          ? "Set the next follow-up date"
          : "Make first contact (call or WhatsApp)";
  return { items, next };
}
