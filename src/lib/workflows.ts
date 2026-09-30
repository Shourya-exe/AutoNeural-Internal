import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, allUsers, findTask, requireAdmin, transaction } from "./store";
import { ldb, nextOwner, systemActor } from "./leads";
import { audit, emit, takeEvents, type BusinessEvent } from "./platform";
import { sendEmail, notifyTaskAssigned } from "./email";
import type { User } from "./types";

/**
 * Workflow engine v1.
 *
 *   trigger (business event) → conditions → steps[]
 *
 * Steps run in order; `wait` pauses the run and the minute loop resumes it. Any step can
 * carry its own `when` condition (evaluated on fresh lead data), which gives simple
 * branching such as "if still New after 30 minutes, call with AI". Workflows start as
 * drafts; activation shows the estimated variable cost and is audited. Events caused by a
 * workflow never re-trigger that workflow, and chains stop at depth 3.
 */

export const triggers = ["lead.created", "lead.stage_changed", "whatsapp.inbound", "call.completed", "quote.accepted", "invoice.paid"] as const satisfies readonly BusinessEvent[];
const ops = ["equals", "not_equals", "contains", "gt", "lt", "is_empty", "not_empty"] as const;
const condition = z.object({ field: z.string().min(1).max(40), op: z.enum(ops), value: z.string().max(200).default("") });
const step = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wait"), minutes: z.number().int().min(1).max(43_200) }),
  z.object({ type: z.literal("whatsapp_template"), template: z.string().min(1).max(120), withName: z.boolean().default(true), category: z.enum(["marketing", "utility"]).default("utility") }),
  z.object({ type: z.literal("email"), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }),
  z.object({ type: z.literal("assign"), to: z.string().min(1).max(64) }), // "round_robin" or a user id
  z.object({ type: z.literal("set_stage"), stage: z.string().min(1).max(30) }),
  z.object({ type: z.literal("create_task"), title: z.string().min(3).max(180), dueInDays: z.number().int().min(0).max(365).default(0), priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("High") }),
  z.object({ type: z.literal("ai_call"), briefing: z.string().max(1000).default("") }),
  z.object({ type: z.literal("ai_whatsapp"), enabled: z.boolean() }),
  z.object({ type: z.literal("notify_owner"), message: z.string().min(1).max(1000) }),
]);
const stepWithWhen = z.intersection(step, z.object({ when: condition.optional() }));
export const workflowSchema = z.object({
  name: z.string().trim().min(2).max(120),
  trigger: z.enum(triggers),
  conditions: z.array(condition).max(10).default([]),
  steps: z.array(stepWithWhen).min(1).max(20),
});
export type WorkflowDef = z.infer<typeof workflowSchema>;
type Step = z.infer<typeof stepWithWhen>;

let ready = false;
function fdb() {
  const c = ldb();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,name TEXT NOT NULL,trigger TEXT NOT NULL,definition TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,createdBy TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_runs(id TEXT PRIMARY KEY,workflowId TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,leadId TEXT,event TEXT NOT NULL,eventData TEXT NOT NULL,status TEXT NOT NULL,stepIndex INTEGER NOT NULL DEFAULT 0,resumeAt TEXT,log TEXT NOT NULL DEFAULT '[]',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS workflow_runs_wait ON workflow_runs(status, resumeAt);`);
    ready = true;
  }
  return c;
}
const now = () => new Date().toISOString();

// ─── Definitions ─────────────────────────────────────────────────────────────

export function listWorkflows(user: User) {
  requireAdmin(user);
  const rows = fdb().prepare("SELECT * FROM workflows ORDER BY createdAt DESC").all() as Record<string, any>[];
  const stats = fdb().prepare("SELECT workflowId, status, COUNT(*) AS n FROM workflow_runs GROUP BY workflowId, status").all() as { workflowId: string; status: string; n: number }[];
  return rows.map((w) => ({
    ...w,
    definition: JSON.parse(w.definition) as WorkflowDef,
    runs: Object.fromEntries(stats.filter((s) => s.workflowId === w.id).map((s) => [s.status, s.n])),
  }));
}

export function saveWorkflow(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ id: z.string().uuid().optional(), definition: workflowSchema }).parse(input);
  validateRefs(p.definition);
  const t = now();
  if (p.id) {
    // Editing a live workflow takes it back to draft, so the change is reviewed again.
    fdb().prepare("UPDATE workflows SET name=?, trigger=?, definition=?, enabled=0, updatedAt=? WHERE id=?").run(p.definition.name, p.definition.trigger, JSON.stringify(p.definition), t, p.id);
    audit(user.name, "workflow.edit", "workflow", p.id, p.definition);
    return { id: p.id };
  }
  const id = randomUUID();
  fdb().prepare("INSERT INTO workflows VALUES(?,?,?,?,0,?,?,?)").run(id, p.definition.name, p.definition.trigger, JSON.stringify(p.definition), user.id, t, t);
  audit(user.name, "workflow.create", "workflow", id, p.definition);
  return { id };
}

function validateRefs(d: WorkflowDef) {
  const ids = new Set(allUsers().map((u) => u.id));
  for (const s of d.steps) if (s.type === "assign" && s.to !== "round_robin" && !ids.has(s.to)) throw new AppError(400, `Step "assign": unknown teammate.`);
}

/** Variable cost per run, using the admin's rate card; null rates are reported as unknown. */
export function estimate(d: WorkflowDef, rates: { voicePerMinute: number | null; aiCredit: number | null; waMarketing: number | null; waUtility: number | null }) {
  const lines: { what: string; cost: number | null }[] = [];
  for (const s of d.steps) {
    if (s.type === "ai_call") lines.push({ what: "AI call (~3 min)", cost: rates.voicePerMinute == null ? null : 3 * rates.voicePerMinute });
    if (s.type === "whatsapp_template") lines.push({ what: `WhatsApp ${s.category} template`, cost: (s.category === "marketing" ? rates.waMarketing : rates.waUtility) ?? null });
    if (s.type === "ai_whatsapp" && s.enabled) lines.push({ what: "AI WhatsApp replies (~3 credits)", cost: rates.aiCredit == null ? null : 3 * rates.aiCredit });
  }
  const known = lines.every((l) => l.cost != null);
  return { lines, perRun: known ? lines.reduce((a, l) => a + (l.cost ?? 0), 0) : null };
}

export function recentEventVolume(trigger: string) {
  return Number((ldb().prepare("SELECT COUNT(*) AS n FROM workflow_queue WHERE event=? AND createdAt>=?").get(trigger, new Date(Date.now() - 30 * 86_400_000).toISOString()) as { n: number }).n);
}

export function setEnabled(user: User, id: string, enabled: boolean) {
  requireAdmin(user);
  const w = fdb().prepare("SELECT id FROM workflows WHERE id=?").get(id);
  if (!w) throw new AppError(404, "Workflow not found.");
  fdb().prepare("UPDATE workflows SET enabled=?, updatedAt=? WHERE id=?").run(enabled ? 1 : 0, now(), id);
  audit(user.name, enabled ? "workflow.activate" : "workflow.pause", "workflow", id);
  return { ok: true };
}

export function deleteWorkflow(user: User, id: string) {
  requireAdmin(user);
  fdb().prepare("DELETE FROM workflows WHERE id=?").run(id);
  audit(user.name, "workflow.delete", "workflow", id);
}

export function listRuns(user: User, workflowId: string) {
  requireAdmin(user);
  return (fdb().prepare("SELECT r.*, l.name AS leadName FROM workflow_runs r LEFT JOIN leads l ON l.id=r.leadId WHERE workflowId=? ORDER BY r.createdAt DESC LIMIT 100").all(workflowId) as Record<string, any>[]).map((r) => ({
    ...r,
    log: JSON.parse(r.log),
  }) as Record<string, any>);
}

// ─── Execution ───────────────────────────────────────────────────────────────

function leadCtx(leadId: string | null, data: Record<string, unknown>) {
  const lead = leadId ? (ldb().prepare("SELECT * FROM leads WHERE id=?").get(leadId) as Record<string, any> | undefined) : undefined;
  return {
    ...(lead ?? {}),
    ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v])),
    hasEmail: lead?.email ? "yes" : "no",
    hasPhone: lead?.phone ? "yes" : "no",
    hourIST: String(new Date(Date.now() + 330 * 60_000).getUTCHours()),
  } as Record<string, unknown>;
}

export function matches(c: z.infer<typeof condition>, ctx: Record<string, unknown>) {
  const v = ctx[c.field];
  const s = v == null ? "" : String(v).toLowerCase();
  const want = c.value.toLowerCase();
  switch (c.op) {
    case "equals":
      return s === want;
    case "not_equals":
      return s !== want;
    case "contains":
      return s.includes(want);
    case "gt":
      return Number(v) > Number(c.value);
    case "lt":
      return Number(v) < Number(c.value);
    case "is_empty":
      return s === "";
    case "not_empty":
      return s !== "";
  }
}

let busy = false;
/** Turn queued events into runs, then advance runs whose wait is over. Safe to call often. */
export async function processQueue() {
  if (busy) return;
  busy = true;
  try {
    const events = takeEvents();
    if (events.length) {
      const live = (fdb().prepare("SELECT id, trigger, definition FROM workflows WHERE enabled=1").all() as { id: string; trigger: string; definition: string }[]).map((w) => ({
        id: w.id,
        trigger: w.trigger,
        def: JSON.parse(w.definition) as WorkflowDef,
      }));
      for (const e of events) {
        if (Number(e.data.depth ?? 0) >= 3) continue;
        for (const w of live) {
          if (w.trigger !== e.event || e.data.byWorkflow === w.id) continue;
          const ctx = leadCtx(e.leadId, e.data);
          if (!w.def.conditions.every((c) => matches(c, ctx))) continue;
          const id = randomUUID();
          fdb().prepare("INSERT INTO workflow_runs(id,workflowId,leadId,event,eventData,status,createdAt,updatedAt) VALUES(?,?,?,?,?,'running',?,?)").run(id, w.id, e.leadId, e.event, JSON.stringify(e.data), now(), now());
          await advance(id, w.def);
        }
      }
    }
    const due = fdb().prepare("SELECT r.id, w.definition FROM workflow_runs r JOIN workflows w ON w.id=r.workflowId WHERE r.status='waiting' AND r.resumeAt<=? AND w.enabled=1 LIMIT 100").all(now()) as { id: string; definition: string }[];
    for (const r of due) {
      fdb().prepare("UPDATE workflow_runs SET status='running' WHERE id=? AND status='waiting'").run(r.id);
      await advance(r.id, JSON.parse(r.definition));
    }
  } finally {
    busy = false;
  }
}

async function advance(runId: string, def: WorkflowDef) {
  const run = fdb().prepare("SELECT * FROM workflow_runs WHERE id=?").get(runId) as Record<string, any>;
  const log = JSON.parse(run.log) as { at: string; step: string; result: string }[];
  const data = JSON.parse(run.eventData) as Record<string, unknown>;
  const save = (status: string, stepIndex: number, resumeAt: string | null = null) =>
    fdb().prepare("UPDATE workflow_runs SET status=?, stepIndex=?, resumeAt=?, log=?, updatedAt=? WHERE id=?").run(status, stepIndex, resumeAt, JSON.stringify(log), now(), runId);
  for (let i = run.stepIndex as number; i < def.steps.length; i++) {
    const s = def.steps[i];
    if (s.type === "wait") {
      log.push({ at: now(), step: `wait ${s.minutes} min`, result: "waiting" });
      save("waiting", i + 1, new Date(Date.now() + s.minutes * 60_000).toISOString());
      return;
    }
    if (s.when && !matches(s.when, leadCtx(run.leadId, data))) {
      log.push({ at: now(), step: s.type, result: `skipped (${s.when.field} ${s.when.op} ${s.when.value})` });
      continue;
    }
    try {
      log.push({ at: now(), step: s.type, result: await runStep(s, run.leadId, { ...data, byWorkflow: run.workflowId, depth: Number(data.depth ?? 0) + 1 }) });
    } catch (e) {
      log.push({ at: now(), step: s.type, result: `failed: ${(e as Error).message}` });
      save("failed", i);
      return;
    }
  }
  save("done", def.steps.length);
}

async function runStep(s: Step, leadId: string | null, meta: Record<string, unknown>): Promise<string> {
  const lead = leadId ? (ldb().prepare("SELECT * FROM leads WHERE id=?").get(leadId) as Record<string, any> | undefined) : undefined;
  if (!lead) throw new Error("no lead on this event");
  const actor = systemActor();
  const first = String(lead.name).split(" ")[0];
  const fill = (t: string) => t.replaceAll("{{name}}", first).replaceAll("{{service}}", lead.service ?? "your enquiry");
  switch (s.type) {
    case "whatsapp_template": {
      if (!lead.phone) return "skipped (no phone)";
      const { sendTemplate } = await import("./whatsapp");
      await sendTemplate(null, { phone: lead.phone, name: lead.name, leadId }, s.template, { params: s.withName ? [first] : [], category: s.category });
      return `sent template ${s.template}`;
    }
    case "email": {
      if (!lead.email || lead.optOut) return "skipped (no email or opted out)";
      const r = await sendEmail({ to: lead.email, subject: fill(s.subject), html: fill(s.body).replace(/\n/g, "<br>") });
      if (!r.success) throw new Error(r.error || "email failed");
      return `emailed ${lead.email}`;
    }
    case "assign": {
      const to = s.to === "round_robin" ? nextOwner(actor) : allUsers().find((u) => u.id === s.to);
      if (!to) throw new Error("teammate not found");
      transaction(() => {
        ldb().prepare("UPDATE leads SET ownerId=?, updatedAt=? WHERE id=?").run(to.id, now(), leadId);
        if (lead.taskId) ldb().prepare("UPDATE tasks SET assigneeId=?, updatedAt=?, version=version+1 WHERE id=?").run(to.id, now(), lead.taskId);
      });
      if (lead.taskId && to.id !== actor.id) void notifyTaskAssigned(findTask(actor, lead.taskId), to, actor);
      return `assigned to ${to.name}`;
    }
    case "set_stage": {
      ldb().prepare("UPDATE leads SET status=?, updatedAt=? WHERE id=?").run(s.stage, now(), leadId);
      if (s.stage !== lead.status) emit("lead.stage_changed", leadId, { from: lead.status, to: s.stage, ...meta });
      return `stage → ${s.stage}`;
    }
    case "create_task": {
      const id = randomUUID();
      const due = new Date(Date.now() + 330 * 60_000 + s.dueInDays * 86_400_000).toISOString().slice(0, 10);
      const assignee = lead.ownerId ?? actor.id;
      ldb()
        .prepare("INSERT INTO tasks(id,title,description,assigneeId,createdBy,status,priority,dueDate,project,createdAt,updatedAt,completedAt) VALUES(?,?,?,?,?,'To do',?,?,'Leads',?,?,NULL)")
        .run(id, fill(s.title).slice(0, 180), `Created by automation for ${lead.name}${lead.phone ? ` (${lead.phone})` : ""}.`, assignee, actor.id, s.priority, due, now(), now());
      ldb().prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(randomUUID(), id, actor.id, "Created by an automation workflow.", now());
      return `task "${fill(s.title)}" due ${due}`;
    }
    case "ai_call": {
      if (!lead.phone) return "skipped (no phone)";
      const { placeCall } = await import("./voice");
      const r = await placeCall(actor, { leadId, context: s.briefing ? fill(s.briefing) : undefined });
      return `AI call started (${r.roomName})`;
    }
    case "ai_whatsapp": {
      const { wdb } = await import("./whatsapp");
      const res = wdb().prepare("UPDATE wa_conversations SET aiMode=? WHERE leadId=?").run(s.enabled ? 1 : 0, leadId);
      return `AI WhatsApp ${s.enabled ? "on" : "off"} (${res.changes} conversation)`;
    }
    case "notify_owner": {
      if (!lead.taskId) return "skipped (no task)";
      ldb().prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(randomUUID(), lead.taskId, actor.id, `Automation: ${fill(s.message)}`, now());
      ldb().prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(now(), lead.taskId);
      return "owner notified on the lead's task";
    }
    case "wait":
      return "waited";
  }
}

// ─── AI workflow builder ─────────────────────────────────────────────────────

/** Natural language → a validated DRAFT. It is never activated automatically. */
export async function draftFromText(user: User, text: unknown) {
  requireAdmin(user);
  const want = z.string().trim().min(10).max(1000).parse(text);
  const { gemini } = await import("./ai");
  const team = allUsers().map((u) => ({ id: u.id, name: u.name }));
  const raw = await gemini(
    `Convert the business owner's request into ONE workflow JSON for an Indian SME CRM. Output JSON only with this shape:
{"name": string, "trigger": one of ${JSON.stringify(triggers)}, "conditions": [{"field","op","value"}], "steps": [step]}
Condition fields: source (Website / API, Google Sheet, IndiaMART, Manual, AI call, WhatsApp), sourceDetail, status, service, city, value, hasEmail, hasPhone, hourIST, text (WhatsApp message), callStatus (completed|missed|busy|failed), sentiment, to (new stage), outcome. Ops: ${JSON.stringify(ops)}.
Step types: {"type":"wait","minutes"}, {"type":"whatsapp_template","template":"name or name:lang","withName":true,"category":"utility|marketing"}, {"type":"email","subject","body"}, {"type":"assign","to":"round_robin" or a user id from TEAM}, {"type":"set_stage","stage": New|Contacted|Qualified|Proposal|Negotiation|Won|Lost}, {"type":"create_task","title","dueInDays","priority"}, {"type":"ai_call","briefing"}, {"type":"ai_whatsapp","enabled":true|false}, {"type":"notify_owner","message"}.
Any step may include "when": {"field","op","value"} to run only if true at that moment. Use {{name}} in messages. If a WhatsApp template name is not given, use "TEMPLATE_NAME" so the owner fills it in.
TEAM: ${JSON.stringify(team)}`,
    want,
    true,
    "workflow_builder",
  );
  const parsed = workflowSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new AppError(422, `The AI draft was not valid (${parsed.error.issues[0]?.message}). Try rephrasing.`);
  return parsed.data;
}
