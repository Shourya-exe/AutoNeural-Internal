"use client";
import { useEffect, useState } from "react";
import { Pause, Play, Plus, Sparkles, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { Empty, Modal, Panel, day, inr, post, useAction, useData } from "./kit";

type Cond = { field: string; op: string; value: string };
type Step = { type: string; when?: Cond; [k: string]: unknown };
type Def = { name: string; trigger: string; conditions: Cond[]; steps: Step[] };
type Wf = { id: string; name: string; enabled: number; definition: Def; runs: Record<string, number>; updatedAt: string };

const TRIGGERS: Record<string, string> = {
  "lead.created": "A new lead arrives",
  "lead.stage_changed": "A lead changes stage",
  "whatsapp.inbound": "A WhatsApp message comes in",
  "call.completed": "A call ends (AI or human)",
  "quote.accepted": "A customer accepts a quotation",
  "invoice.paid": "An invoice is fully paid",
};
const FIELDS = ["source", "sourceDetail", "status", "service", "city", "value", "hasEmail", "hasPhone", "hourIST", "text", "callStatus", "sentiment", "to", "outcome"];
const OPS: Record<string, string> = { equals: "is", not_equals: "is not", contains: "contains", gt: ">", lt: "<", is_empty: "is empty", not_empty: "is not empty" };
const STEPS: Record<string, { label: string; blank: Step }> = {
  wait: { label: "Wait", blank: { type: "wait", minutes: 30 } },
  whatsapp_template: { label: "Send WhatsApp template", blank: { type: "whatsapp_template", template: "", withName: true, category: "utility" } },
  email: { label: "Send email", blank: { type: "email", subject: "Thanks for your enquiry, {{name}}", body: "Hi {{name}},\n\n…" } },
  assign: { label: "Assign lead", blank: { type: "assign", to: "round_robin" } },
  set_stage: { label: "Set stage", blank: { type: "set_stage", stage: "Contacted" } },
  create_task: { label: "Create task", blank: { type: "create_task", title: "Follow up with {{name}}", dueInDays: 1, priority: "High" } },
  ai_call: { label: "AI voice call", blank: { type: "ai_call", briefing: "" } },
  ai_whatsapp: { label: "AI WhatsApp agent on/off", blank: { type: "ai_whatsapp", enabled: true } },
  notify_owner: { label: "Notify lead owner", blank: { type: "notify_owner", message: "" } },
};
const W = (payload: Record<string, unknown>) => post("/api/workflows", payload);
const describe = (s: Step) =>
  ({
    wait: `Wait ${s.minutes} min`,
    whatsapp_template: `WhatsApp template “${s.template}”`,
    email: `Email “${s.subject}”`,
    assign: `Assign to ${s.to === "round_robin" ? "next salesperson" : "a teammate"}`,
    set_stage: `Stage → ${s.stage}`,
    create_task: `Task “${s.title}”`,
    ai_call: "AI voice call",
    ai_whatsapp: `AI WhatsApp ${s.enabled ? "on" : "off"}`,
    notify_owner: "Notify owner",
  })[s.type] ?? s.type;

export function AutomationsView({ notify }: { notify: (m: string) => void }) {
  const { data, reload } = useData<{ workflows: Wf[]; team: { id: string; name: string }[] }>("/api/workflows", 15_000);
  const { busy, run } = useAction(notify, reload);
  const [edit, setEdit] = useState<{ id?: string; def: Def } | null>(null);
  const [review, setReview] = useState<Wf | null>(null);
  const [runs, setRuns] = useState<Wf | null>(null);
  const [prompt, setPrompt] = useState("");
  return (
    <div className="leads-page">
      <Panel title="Describe an automation" sub="AI turns it into a draft you review. Nothing runs until you activate it.">
        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => W({ action: "draft", text: prompt }).then((r) => setEdit({ def: r.definition })));
          }}
        >
          <Sparkles size={16} />
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="When a Facebook lead arrives, WhatsApp them, wait 30 minutes, and if they’re still New call them with AI" aria-label="Describe the automation" />
          <button className="button primary" disabled={busy || prompt.trim().length < 10}>{busy ? "Drafting…" : "Draft"}</button>
        </form>
      </Panel>
      <Panel
        title="Automations"
        sub="Trigger → conditions → steps. Edits send a live workflow back to draft for review."
        actions={<button className="button" onClick={() => setEdit({ def: { name: "", trigger: "lead.created", conditions: [], steps: [STEPS.create_task.blank] } })}><Plus size={15} /> Build manually</button>}
      >
        {!data?.workflows.length ? (
          <Empty>No automations yet.</Empty>
        ) : (
          <ul className="call-list">
            {data.workflows.map((w) => (
              <li key={w.id} className="wf-row">
                <div>
                  <strong>{w.name}</strong>
                  <small className="lead-sub">When {TRIGGERS[w.definition.trigger]?.toLowerCase()}{w.definition.conditions.length ? ` and ${w.definition.conditions.map((c) => `${c.field} ${OPS[c.op]} ${c.value}`).join(", ")}` : ""}: {w.definition.steps.map(describe).join(" → ")}</small>
                </div>
                <span className={`call-badge ${w.enabled ? "completed" : ""}`}>{w.enabled ? "Live" : "Draft"}</span>
                <button className="text-button" onClick={() => setRuns(w)}>{Object.values(w.runs).reduce((a, n) => a + n, 0)} runs{w.runs.failed ? ` · ${w.runs.failed} failed` : ""}</button>
                <span className="row-actions">
                  <button className="text-button" onClick={() => setEdit({ id: w.id, def: w.definition })}>Edit</button>
                  {w.enabled ? (
                    <button className="text-button" disabled={busy} onClick={() => run(() => W({ action: "enable", id: w.id, enabled: false }), "Paused.")}><Pause size={12} /> Pause</button>
                  ) : (
                    <button className="text-button" onClick={() => setReview(w)}><Play size={12} /> Review & activate</button>
                  )}
                  <button className="text-button" disabled={busy} onClick={() => confirm(`Delete "${w.name}"?`) && run(() => W({ action: "delete", id: w.id }), "Deleted.")}><Trash2 size={12} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {edit && <Editor initial={edit} team={data?.team ?? []} busy={busy} onClose={() => setEdit(null)} onSave={(id, def) => run(() => W({ action: "save", id, definition: def }), "Saved as draft. Review & activate when ready.").then(() => setEdit(null))} />}
      {review && <Review wf={review} busy={busy} onClose={() => setReview(null)} onActivate={() => run(() => W({ action: "enable", id: review.id, enabled: true }), "Automation is live.").then(() => setReview(null))} />}
      {runs && <Runs wf={runs} onClose={() => setRuns(null)} />}
    </div>
  );
}

function CondEditor({ c, onChange, onRemove }: { c: Cond; onChange: (c: Cond) => void; onRemove: () => void }) {
  return (
    <div className="cond-row">
      <select value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })} aria-label="Field">{FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
      <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })} aria-label="Operator">{Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Value" disabled={c.op.endsWith("empty")} />
      <button type="button" className="icon-button" aria-label="Remove condition" onClick={onRemove}><Trash2 size={13} /></button>
    </div>
  );
}

function Editor({ initial, team, busy, onClose, onSave }: { initial: { id?: string; def: Def }; team: { id: string; name: string }[]; busy: boolean; onClose: () => void; onSave: (id: string | undefined, def: Def) => void }) {
  const [d, setD] = useState<Def>(initial.def);
  const setStep = (i: number, s: Step) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const field = (i: number, s: Step, key: string, kind: "text" | "number" | "area" | "bool" = "text", label = key) => (
    <label key={key} className={kind === "bool" ? "check" : ""}>
      {kind === "bool" ? (
        <><input type="checkbox" checked={!!s[key]} onChange={(e) => setStep(i, { ...s, [key]: e.target.checked })} /> {label}</>
      ) : (
        <>
          {label}
          {kind === "area" ? (
            <textarea rows={3} value={String(s[key] ?? "")} onChange={(e) => setStep(i, { ...s, [key]: e.target.value })} />
          ) : (
            <input type={kind === "number" ? "number" : "text"} value={String(s[key] ?? "")} onChange={(e) => setStep(i, { ...s, [key]: kind === "number" ? Number(e.target.value) : e.target.value })} />
          )}
        </>
      )}
    </label>
  );
  return (
    <Modal title={initial.id ? "Edit automation" : "New automation"} onClose={onClose} wide>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(initial.id, d);
        }}
      >
        <label>Name<input required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Facebook lead: instant WhatsApp + AI call" /></label>
        <label>When<select value={d.trigger} onChange={(e) => setD({ ...d, trigger: e.target.value })}>{Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="wf-block">
          <strong>Only if</strong>
          {d.conditions.map((c, i) => (
            <CondEditor key={i} c={c} onChange={(n) => setD({ ...d, conditions: d.conditions.map((x, j) => (j === i ? n : x)) })} onRemove={() => setD({ ...d, conditions: d.conditions.filter((_, j) => j !== i) })} />
          ))}
          <button type="button" className="text-button" onClick={() => setD({ ...d, conditions: [...d.conditions, { field: "source", op: "equals", value: "" }] })}><Plus size={12} /> Condition</button>
        </div>
        <div className="wf-block">
          <strong>Then</strong>
          {d.steps.map((s, i) => (
            <div key={i} className="wf-step">
              <header>
                <span>{i + 1}.</span>
                <select value={s.type} onChange={(e) => setStep(i, { ...STEPS[e.target.value].blank, when: s.when })} aria-label="Step type">{Object.entries(STEPS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                <button type="button" className="icon-button" aria-label="Remove step" disabled={d.steps.length === 1} onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
              </header>
              <div className="form-grid">
                {s.type === "wait" && field(i, s, "minutes", "number", "Minutes")}
                {s.type === "whatsapp_template" && [field(i, s, "template", "text", "Approved template (name or name:lang)"), field(i, s, "withName", "bool", "Pass first name as {{1}}")]}
                {s.type === "whatsapp_template" && (
                  <label>Category<select value={String(s.category)} onChange={(e) => setStep(i, { ...s, category: e.target.value })}><option value="utility">Utility</option><option value="marketing">Marketing</option></select></label>
                )}
                {s.type === "email" && [field(i, s, "subject", "text", "Subject"), field(i, s, "body", "area", "Message")]}
                {s.type === "assign" && (
                  <label>To<select value={String(s.to)} onChange={(e) => setStep(i, { ...s, to: e.target.value })}><option value="round_robin">Next available salesperson</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                )}
                {s.type === "set_stage" && (
                  <label>Stage<select value={String(s.stage)} onChange={(e) => setStep(i, { ...s, stage: e.target.value })}>{["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"].map((x) => <option key={x}>{x}</option>)}</select></label>
                )}
                {s.type === "create_task" && [field(i, s, "title", "text", "Title"), field(i, s, "dueInDays", "number", "Due in days")]}
                {s.type === "ai_call" && field(i, s, "briefing", "area", "Briefing for Riya")}
                {s.type === "ai_whatsapp" && field(i, s, "enabled", "bool", "Turn the AI agent on")}
                {s.type === "notify_owner" && field(i, s, "message", "area", "Message")}
              </div>
              {s.when ? (
                <div className="wf-when">
                  <small>Run this step only if</small>
                  <CondEditor c={s.when} onChange={(n) => setStep(i, { ...s, when: n })} onRemove={() => setStep(i, { ...s, when: undefined })} />
                </div>
              ) : (
                <button type="button" className="text-button" onClick={() => setStep(i, { ...s, when: { field: "status", op: "equals", value: "New" } })}>+ Only if…</button>
              )}
            </div>
          ))}
          <button type="button" className="text-button" onClick={() => setD({ ...d, steps: [...d.steps, STEPS.wait.blank] })}><Plus size={12} /> Step</button>
        </div>
        <p className="hint">Use {"{{name}}"} and {"{{service}}"} in messages. Saving keeps it as a draft.</p>
        <div className="modal-actions"><button className="button primary" disabled={busy}><WorkflowIcon size={14} /> Save draft</button></div>
      </form>
    </Modal>
  );
}

function Review({ wf, busy, onClose, onActivate }: { wf: Wf; busy: boolean; onClose: () => void; onActivate: () => void }) {
  const [e, setE] = useState<{ lines: { what: string; cost: number | null }[]; perRun: number | null; eventsLast30Days: number } | null>(null);
  useEffect(() => {
    void W({ action: "estimate", definition: wf.definition }).then(setE, () => setE({ lines: [], perRun: null, eventsLast30Days: 0 }));
  }, [wf]);
  return (
    <Modal title={`Activate “${wf.name}”?`} onClose={onClose}>
      <p className="modal-intro">When {TRIGGERS[wf.definition.trigger]?.toLowerCase()}: {wf.definition.steps.map(describe).join(" → ")}</p>
      {!e ? (
        <p className="hint">Estimating cost…</p>
      ) : (
        <div className="ai-card">
          <h4>Variable cost per run</h4>
          {e.lines.length ? (
            <ul>{e.lines.map((l, i) => <li key={i}>{l.what}: {l.cost == null ? "rate not set" : inr(l.cost)}</li>)}</ul>
          ) : (
            <p>No paid steps (email, tasks and assignment are included).</p>
          )}
          <h4>Monthly estimate</h4>
          <p>
            {e.eventsLast30Days} matching events in the last 30 days (before conditions).{" "}
            {e.perRun == null ? "Set your rates under Usage for a money estimate." : `Up to ${inr(e.perRun * e.eventsLast30Days)} a month.`}
          </p>
        </div>
      )}
      <div className="modal-actions">
        <button className="button" onClick={onClose}>Not yet</button>
        <button className="button primary" disabled={busy || !e} onClick={onActivate}><Play size={14} /> Activate</button>
      </div>
    </Modal>
  );
}

function Runs({ wf, onClose }: { wf: Wf; onClose: () => void }) {
  const { data } = useData<{ runs: { id: string; leadName: string | null; status: string; createdAt: string; log: { at: string; step: string; result: string }[] }[] }>(`/api/workflows?runs=${wf.id}`, 10_000);
  return (
    <Modal title={`Runs · ${wf.name}`} onClose={onClose} wide>
      {!data?.runs.length ? (
        <Empty>No runs yet.</Empty>
      ) : (
        <ol className="ticket-trail">
          {data.runs.map((r) => (
            <li key={r.id}>
              <strong>{r.leadName ?? "—"}</strong> · {r.status} · {day(r.createdAt)} {new Date(r.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              <br />
              {r.log.map((l) => `${l.step}: ${l.result}`).join(" → ")}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
