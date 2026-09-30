"use client";
import { useState, type ReactNode } from "react";
import { Bot, CalendarPlus, ExternalLink, FileText, History, LifeBuoy, Mail, Phone, PhoneOutgoing, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import type { User } from "@/lib/types";
import { Empty, Modal, Panel, Stats, day, formObj, inr, post, todayIST, useAction, useData } from "./kit";

export const stages = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"] as const;

export type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  service: string | null;
  city: string | null;
  source: string;
  sourceDetail: string | null;
  status: string;
  ownerName: string | null;
  value: number | null;
  nextFollowUp: string | null;
  lostReason: string | null;
  taskId: string | null;
  createdAt: string;
};
type Compose = (p: { to?: string; subject?: string; text?: string }) => void;
const S = (url: string, payload: Record<string, unknown>) => post("/api/sales", payload);

// ─── Lead panel: deal, AI help, quote, meeting, ticket ───────────────────────

export function LeadPanel({ lead, user, notify, onClose, onChanged, onCompose }: { lead: LeadRow; user: User; notify: (m: string) => void; onClose: () => void; onChanged: () => void; onCompose: Compose }) {
  const [mode, setMode] = useState<"timeline" | "call" | "deal" | "guide" | "email" | "quote" | "meeting" | "ticket">("timeline");
  const { busy, run } = useAction(notify, onChanged);
  const [guide, setGuide] = useState<{ overview: string; company: string; pitch: string[]; questions: string[]; nextAction: string } | null>(null);
  const meetings = useData<{ meetings: { id: string; title: string; startsAt: string; link: string; provider: string }[] }>(`/api/sales?view=meetings&leadId=${lead.id}`);
  const tabs: [typeof mode, string, ReactNode][] = [
    ["timeline", "Timeline", <History size={13} key="h" />],
    ["call", "Call", <Phone size={13} key="p" />],
    ["deal", "Deal", null],
    ["guide", "AI guidance", <Sparkles size={13} key="s" />],
    ["email", "AI email", <Mail size={13} key="m" />],
    ["quote", "Quotation", <FileText size={13} key="q" />],
    ["meeting", "Meeting", <CalendarPlus size={13} key="c" />],
    ["ticket", "Grievance", <LifeBuoy size={13} key="t" />],
  ];
  return (
    <Modal title={lead.name} onClose={onClose} wide>
      <p className="modal-intro">
        {[lead.company, lead.service, lead.city, lead.sourceDetail || lead.source].filter(Boolean).join(" · ")}
        {lead.phone ? ` · ${lead.phone}` : ""}
        {lead.email ? ` · ${lead.email}` : ""}
      </p>
      <div className="seg-tabs" role="tablist">
        {tabs.map(([k, label, icon]) => (
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "active" : ""} onClick={() => setMode(k)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {mode === "timeline" && <Timeline leadId={lead.id} />}
      {mode === "call" && <CallTab lead={lead} busy={busy} run={run} onDone={() => setMode("timeline")} />}
      {mode === "deal" && (
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = formObj(e.currentTarget);
            void run(
              () => S("", { action: "deal", id: lead.id, status: f.status, value: f.value ? Number(f.value) : null, nextFollowUp: f.nextFollowUp || null, lostReason: f.lostReason || undefined }),
              "Deal updated.",
            );
          }}
        >
          <div className="form-grid">
            <label>
              Stage
              <select name="status" defaultValue={lead.status}>
                {stages.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Deal value (₹)
              <input name="value" type="number" min={0} step="1" defaultValue={lead.value ?? ""} />
            </label>
            <label>
              Next follow-up
              <input name="nextFollowUp" type="date" defaultValue={lead.nextFollowUp ?? ""} />
            </label>
            <label>
              Lost reason <span className="optional">if lost</span>
              <input name="lostReason" defaultValue={lead.lostReason ?? ""} placeholder="Price, timing, chose competitor…" />
            </label>
          </div>
          {meetings.data?.meetings.length ? (
            <div className="mini-list">
              <strong>Meetings</strong>
              {meetings.data.meetings.map((m) => (
                <a key={m.id} href={m.link} target="_blank" rel="noreferrer">
                  {new Date(m.startsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} — {m.title} <ExternalLink size={11} />
                </a>
              ))}
            </div>
          ) : null}
          <div className="modal-actions">
            <button className="button primary" disabled={busy}>Save deal</button>
          </div>
        </form>
      )}

      {mode === "guide" && (
        <div className="stack-form">
          <p className="hint">AI reviews this lead’s details, calls, notes and quotations, then suggests how to pitch. It only uses what’s in the CRM.</p>
          <button className="button primary" disabled={busy} onClick={() => run(() => post("/api/ai", { action: "guidance", leadId: lead.id }).then(setGuide))}>
            <Sparkles size={14} /> {guide ? "Refresh guidance" : "Get sales guidance"}
          </button>
          {guide && (
            <div className="ai-card">
              <h4>Overview</h4>
              <p>{guide.overview}</p>
              <h4>Company</h4>
              <p>{guide.company}</p>
              <h4>Pitch</h4>
              <ul>{guide.pitch.map((p) => <li key={p}>{p}</li>)}</ul>
              <h4>Ask</h4>
              <ul>{guide.questions.map((p) => <li key={p}>{p}</li>)}</ul>
              <h4>Next best action</h4>
              <p>{guide.nextAction}</p>
            </div>
          )}
        </div>
      )}

      {mode === "email" && <EmailDraft lead={lead} busy={busy} run={run} onCompose={onCompose} />}
      {mode === "quote" && <DocumentForm kind="quote" lead={lead} notify={notify} onDone={() => (onChanged(), setMode("deal"))} />}
      {mode === "meeting" && (
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = formObj(e.currentTarget);
            void run(
              () => S("", { action: "meeting", leadId: lead.id, title: f.title, startsAt: new Date(f.startsAt).toISOString(), minutes: Number(f.minutes), provider: f.provider, invite: f.invite === "on" }),
              (r) => `Meeting scheduled${r.invited ? " and invite emailed" : ""}. Link: ${r.link}`,
            ).then(() => meetings.reload());
          }}
        >
          <label>
            Title
            <input name="title" required defaultValue={`${lead.service || "Discovery"} call with ${lead.name}`} />
          </label>
          <div className="form-grid">
            <label>
              Date & time
              <input name="startsAt" type="datetime-local" required />
            </label>
            <label>
              Duration
              <select name="minutes" defaultValue="30">
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </label>
            <label>
              Video
              <select name="provider" defaultValue="jitsi">
                <option value="jitsi">Video link (no account needed)</option>
                <option value="zoom">Zoom</option>
              </select>
            </label>
            <label className="check">
              <input name="invite" type="checkbox" defaultChecked={!!lead.email} disabled={!lead.email} /> Email the invite to {lead.email || "the lead (no email)"}
            </label>
          </div>
          <p className="hint">The meeting is logged on the lead and added to the owner’s tasks.</p>
          <div className="modal-actions">
            <button className="button primary" disabled={busy}><CalendarPlus size={14} /> Schedule</button>
          </div>
        </form>
      )}
      {mode === "ticket" && (
        <TicketForm
          defaults={{ customerName: lead.name, phone: lead.phone ?? "", email: lead.email ?? "" }}
          busy={busy}
          onSubmit={(ticket) => run(() => S("", { action: "ticket", ticket }), "Grievance logged.").then(() => setMode("deal"))}
        />
      )}
    </Modal>
  );
}

type TItem = { at: string; kind: string; title: string; detail?: string | null; by?: string | null; link?: string | null };

function Timeline({ leadId }: { leadId: string }) {
  const { data, error } = useData<{ items: TItem[]; next: string | null }>(`/api/customer?leadId=${leadId}`, 10_000);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="hint">Loading timeline…</p>;
  return (
    <div className="stack-form">
      {data.next && <p className="next-action"><strong>Next action:</strong> {data.next}</p>}
      <ol className="timeline">
        {data.items.map((i, n) => (
          <li key={n} className={`t-${i.kind}`}>
            <span className="t-dot" aria-hidden />
            <div>
              <strong>{i.title}</strong>
              <small>
                {new Date(i.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                {i.by ? ` · ${i.by}` : ""}
                {i.link ? <> · <a href={i.link} target="_blank" rel="noreferrer">open</a></> : null}
              </small>
              {i.detail && <p>{i.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const dispositions = ["Connected — interested", "Connected — follow up", "Connected — not interested", "No answer", "Busy", "Wrong number", "Call back later"];

function CallTab({ lead, busy, run, onDone }: { lead: LeadRow; busy: boolean; run: ReturnType<typeof useAction>["run"]; onDone: () => void }) {
  const cloud = useData<{ cloudCalling: boolean }>("/api/voice");
  return (
    <div className="stack-form">
      <div className="lead-actions">
        {lead.phone && <a className="button" href={`tel:${lead.phone}`}><Phone size={14} /> Call from this phone</a>}
        {cloud.data?.cloudCalling && (
          <button className="button primary" disabled={busy || !lead.phone} onClick={() => run(() => post("/api/voice", { action: "dial", leadId: lead.id }), (r) => r.message)}>
            <PhoneOutgoing size={14} /> Call via company number
          </button>
        )}
        {lead.phone && <button className="button" disabled={busy} onClick={() => run(() => post("/api/voice", { action: "call", leadId: lead.id }), (r) => r.message)}><Bot size={14} /> AI call</button>}
      </div>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = formObj(e.currentTarget);
          void run(() => post("/api/voice", { action: "log", leadId: lead.id, direction: f.direction, disposition: f.disposition, minutes: Number(f.minutes || 0), notes: f.notes, nextFollowUp: f.nextFollowUp || null }), "Call logged.").then(onDone);
        }}
      >
        <strong>Log a call</strong>
        <div className="form-grid">
          <label>Outcome<select name="disposition">{dispositions.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>Direction<select name="direction"><option value="outbound">I called them</option><option value="inbound">They called</option></select></label>
          <label>Minutes<input name="minutes" type="number" min={0} step="0.5" defaultValue={0} /></label>
          <label>Next follow-up<input name="nextFollowUp" type="date" defaultValue={lead.nextFollowUp ?? ""} /></label>
        </div>
        <label>Notes<textarea name="notes" rows={3} placeholder="What did they say? What was agreed?" /></label>
        <div className="modal-actions"><button className="button primary" disabled={busy}>Save call</button></div>
      </form>
    </div>
  );
}

function EmailDraft({ lead, busy, run, onCompose }: { lead: LeadRow; busy: boolean; run: ReturnType<typeof useAction>["run"]; onCompose: Compose }) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        const purpose = formObj(e.currentTarget).purpose;
        void run(() => post("/api/ai", { action: "email", leadId: lead.id, purpose }).then(setDraft));
      }}
    >
      <label>
        What should the email do?
        <select name="purpose" defaultValue="Follow up on their enquiry and propose a short call">
          <option>Follow up on their enquiry and propose a short call</option>
          <option>Send a thank-you after our call with the agreed next steps</option>
          <option>Share the quotation and invite questions</option>
          <option>Politely remind them about the pending payment</option>
          <option>Re-engage a lead that has gone quiet</option>
        </select>
      </label>
      <button className="button" disabled={busy}><Bot size={14} /> Draft with AI</button>
      {draft && (
        <div className="ai-card">
          <label>
            Subject
            <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </label>
          <label>
            Message
            <textarea rows={9} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" className="button primary" disabled={!lead.email} onClick={() => onCompose({ to: lead.email ?? "", subject: draft.subject, text: draft.body })}>
              <Send size={14} /> {lead.email ? "Review & send from Mail" : "No email on this lead"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

// ─── Pipeline board ──────────────────────────────────────────────────────────

export function PipelineView({ user, notify, onOpen }: { user: User; notify: (m: string) => void; onOpen: (l: LeadRow) => void }) {
  const leads = useData<{ leads: LeadRow[] }>("/api/leads", 20_000);
  const summary = useData<{ summary: { stages: { status: string; n: number; value: number }[]; followUpsDue: number; quotesOpen: { n: number; v: number }; outstanding: { n: number; v: number }; overdue: { n: number; v: number }; collectedThisMonth: number; openTickets: number } }>("/api/sales", 20_000);
  const { run } = useAction(notify, () => (leads.reload(), summary.reload()));
  const [drag, setDrag] = useState<string | null>(null);
  const s = summary.data?.summary;
  const move = (id: string, status: string) => {
    const lostReason = status === "Lost" ? prompt("Why was this deal lost?")?.trim() : undefined;
    if (status === "Lost" && !lostReason) return;
    void run(() => post("/api/sales", { action: "deal", id, status, lostReason }), `Moved to ${status}.`);
  };
  const open = (leads.data?.leads ?? []).filter((l) => !["Won", "Lost"].includes(l.status));
  return (
    <div className="leads-page">
      <Stats
        items={[
          ["Open pipeline", inr(open.reduce((a, l) => a + (l.value ?? 0), 0))],
          ["Follow-ups due", s?.followUpsDue ?? "—"],
          ["Invoices outstanding", s ? inr(s.outstanding.v) : "—"],
          ["Collected this month", s ? inr(s.collectedThisMonth) : "—"],
        ]}
      />
      {leads.error && <p className="error">{leads.error}</p>}
      <div className="kanban" role="list">
        {stages.map((st) => {
          const col = (leads.data?.leads ?? []).filter((l) => l.status === st);
          return (
            <section
              key={st}
              className={`kanban-col ${drag ? "droppable" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag && col.every((l) => l.id !== drag)) move(drag, st);
                setDrag(null);
              }}
            >
              <header>
                <strong>{st}</strong>
                <span>{col.length} · {inr(col.reduce((a, l) => a + (l.value ?? 0), 0))}</span>
              </header>
              {col.slice(0, 60).map((l) => (
                <article key={l.id} className="kanban-card" draggable onDragStart={() => setDrag(l.id)} onDragEnd={() => setDrag(null)}>
                  <button className="text-button" onClick={() => onOpen(l)}>
                    <strong>{l.name}</strong>
                  </button>
                  <small>{[l.service, l.company].filter(Boolean).join(" · ") || l.sourceDetail || l.source}</small>
                  <div className="kanban-meta">
                    <span>{l.value ? inr(l.value) : ""}</span>
                    <span className={l.nextFollowUp && l.nextFollowUp <= todayIST() ? "due" : ""}>{l.nextFollowUp ? `↻ ${day(l.nextFollowUp)}` : ""}</span>
                  </div>
                  {user.role === "admin" && <small>{l.ownerName}</small>}
                  <select className="kanban-move" aria-label={`Move ${l.name}`} value={l.status} onChange={(e) => move(l.id, e.target.value)}>
                    {stages.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ─── Quotations and invoices ─────────────────────────────────────────────────

type Doc = {
  id: string;
  number: string;
  kind: "quote" | "invoice";
  customer: { name: string; email: string; company: string };
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: number;
  paid: number;
  token: string;
  paymentLinks: Record<string, { url: string }> | null;
  payments: { amount: number; method: string; paidAt: string }[];
};
type Company = { name: string; address: string; state: string; gstin: string; email: string; phone: string; upiId: string; bank: string; terms: string };

export function DocumentsView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, error, reload } = useData<{ documents: Doc[]; company: Company; gateways: { razorpay: boolean; stripe: boolean } }>("/api/sales?view=documents", 30_000);
  const { busy, run } = useAction(notify, reload);
  const [creating, setCreating] = useState<"quote" | "invoice" | null>(null);
  const [paying, setPaying] = useState<Doc | null>(null);
  const [editCompany, setEditCompany] = useState(false);
  const [tab, setTab] = useState<"all" | "quote" | "invoice">("all");
  const docs = (data?.documents ?? []).filter((d) => tab === "all" || d.kind === tab);
  const act = (payload: Record<string, unknown>, ok: string | ((r: any) => string)) => run(() => post("/api/sales", payload), ok);
  const due = (data?.documents ?? []).filter((d) => d.kind === "invoice" && ["Unpaid", "Partially paid"].includes(d.status));
  return (
    <div className="leads-page">
      <Stats
        items={[
          ["Open quotations", (data?.documents ?? []).filter((d) => d.kind === "quote" && ["Draft", "Sent"].includes(d.status)).length],
          ["Outstanding", inr(due.reduce((a, d) => a + d.total - d.paid, 0))],
          ["Overdue", inr(due.filter((d) => d.dueDate && d.dueDate < todayIST()).reduce((a, d) => a + d.total - d.paid, 0))],
          ["Collected", inr((data?.documents ?? []).reduce((a, d) => a + d.paid, 0))],
        ]}
      />
      <Panel
        title="Quotations & invoices"
        sub="GST-ready documents with a shareable link, UPI QR and online payment. Customers can accept quotations online."
        actions={
          <>
            <select value={tab} onChange={(e) => setTab(e.target.value as typeof tab)} aria-label="Show">
              <option value="all">All</option>
              <option value="quote">Quotations</option>
              <option value="invoice">Invoices</option>
            </select>
            {user.role === "admin" && <button className="button" onClick={() => setEditCompany(true)}>Company details</button>}
            <button className="button" onClick={() => setCreating("quote")}><Plus size={15} /> Quotation</button>
            <button className="button primary" onClick={() => setCreating("invoice")}><Plus size={15} /> Invoice</button>
          </>
        }
      >
        {error && <p className="error" style={{ padding: "0 22px" }}>{error}</p>}
        {data && !data.company.upiId && user.role === "admin" && (
          <p className="filter-notice">Add your UPI ID and GSTIN under “Company details” so invoices show a pay-by-UPI QR code and correct GST.</p>
        )}
        {!data ? (
          <Empty>Loading…</Empty>
        ) : !docs.length ? (
          <Empty>No documents yet. Create a quotation from a lead, or use the buttons above.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead>
                <tr><th>Number</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.number}</strong>
                      <small className="lead-sub">{d.kind === "quote" ? "Quotation" : "Invoice"}{d.dueDate ? ` · due ${day(d.dueDate)}` : ""}</small>
                    </td>
                    <td>{d.customer.name}<small className="lead-sub">{d.customer.company}</small></td>
                    <td>{day(d.issueDate)}</td>
                    <td>
                      {inr(d.total)}
                      {d.paid > 0 && d.paid < d.total && <small className="lead-sub">paid {inr(d.paid)}</small>}
                    </td>
                    <td><span className={`call-badge ${["Paid", "Accepted"].includes(d.status) ? "completed" : ["Rejected", "Cancelled"].includes(d.status) ? "failed" : ""}`}>{d.status}</span></td>
                    <td className="row-actions">
                      <a className="text-button" href={`/d/${d.token}`} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a>
                      <button className="text-button" disabled={busy || !d.customer.email} title={d.customer.email || "No customer email"} onClick={() => act({ action: "emailDocument", id: d.id }, "Emailed to the customer.")}>Email</button>
                      {d.kind === "quote" && d.status !== "Rejected" && <button className="text-button" disabled={busy} onClick={() => act({ action: "convert", id: d.id }, (r) => `Invoice ${r.number} created.`)}>To invoice</button>}
                      {d.kind === "quote" && ["Draft", "Sent"].includes(d.status) && <button className="text-button" disabled={busy} onClick={() => act({ action: "documentStatus", id: d.id, status: "Rejected" }, "Marked rejected.")}>Rejected</button>}
                      {d.kind === "invoice" && d.status !== "Paid" && (
                        <>
                          {(data.gateways.razorpay || data.gateways.stripe) && (
                            <button className="text-button" disabled={busy} onClick={() => act({ action: "paymentLinks", id: d.id }, (r) => (r.errors?.length ? r.errors.join(" ") : "Payment links added to the invoice page."))}>Pay link</button>
                          )}
                          <button className="text-button" onClick={() => setPaying(d)}>Record payment</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && (
        <Modal title={creating === "quote" ? "New quotation" : "New invoice"} onClose={() => setCreating(null)} wide>
          <DocumentForm kind={creating} notify={notify} onDone={() => (setCreating(null), reload())} />
        </Modal>
      )}
      {paying && (
        <Modal title={`Record payment · ${paying.number}`} onClose={() => setPaying(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              void act({ action: "payment", id: paying.id, amount: Number(f.amount), method: f.method, reference: f.reference }, "Payment recorded.").then(() => setPaying(null));
            }}
          >
            <div className="form-grid">
              <label>Amount (₹)<input name="amount" type="number" step="0.01" min={0.01} defaultValue={Math.round((paying.total - paying.paid) * 100) / 100} required /></label>
              <label>
                Method
                <select name="method">
                  {["UPI", "Bank transfer", "Cash", "Cheque", "Card"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <label>Reference <span className="optional">UTR / cheque no.</span><input name="reference" /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save payment</button></div>
          </form>
        </Modal>
      )}
      {editCompany && data && (
        <Modal title="Company details on documents" onClose={() => setEditCompany(false)} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "company", company: formObj(e.currentTarget) }, "Company details saved.").then(() => setEditCompany(false));
            }}
          >
            <div className="form-grid">
              {(
                [
                  ["name", "Business name"],
                  ["gstin", "GSTIN"],
                  ["state", "State (for CGST/SGST vs IGST)"],
                  ["upiId", "UPI ID (e.g. autoneural@okicici)"],
                  ["phone", "Phone"],
                  ["email", "Email"],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>{label}<input name={k} defaultValue={data.company[k]} required={k === "name"} /></label>
              ))}
            </div>
            <label>Address<textarea name="address" rows={2} defaultValue={data.company.address} /></label>
            <label>Bank details<textarea name="bank" rows={2} defaultValue={data.company.bank} placeholder="A/c name, number, IFSC" /></label>
            <label>Terms & conditions<textarea name="terms" rows={3} defaultValue={data.company.terms} /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

type Item = { description: string; hsn: string; qty: number; rate: number; gst: number };

export function DocumentForm({ kind, lead, notify, onDone }: { kind: "quote" | "invoice"; lead?: LeadRow; notify: (m: string) => void; onDone: () => void }) {
  const [items, setItems] = useState<Item[]>([{ description: lead?.service ?? "", hsn: "998314", qty: 1, rate: lead?.value ?? 0, gst: 18 }]);
  const { busy, run } = useAction(notify, onDone);
  const sub = items.reduce((a, i) => a + i.qty * i.rate, 0);
  const tax = items.reduce((a, i) => a + (i.qty * i.rate * i.gst) / 100, 0);
  const set = (n: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  const due = new Date(Date.now() + (kind === "quote" ? 30 : 15) * 86_400_000).toISOString().slice(0, 10);
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = formObj(e.currentTarget);
        const { notes, dueDate, ...customer } = f;
        void run(
          () => post("/api/sales", { action: "createDocument", document: { kind, leadId: lead?.id ?? null, customer, items: items.map((i) => ({ ...i, qty: Number(i.qty), rate: Number(i.rate), gst: Number(i.gst) })), notes, dueDate: dueDate || null } }),
          (r) => `${r.number} created. Open it from Quotes & Invoices to share.`,
        );
      }}
    >
      <div className="form-grid">
        <label>Customer name<input name="name" required defaultValue={lead?.name} /></label>
        <label>Company<input name="company" defaultValue={lead?.company ?? ""} /></label>
        <label>Email<input name="email" type="email" defaultValue={lead?.email ?? ""} /></label>
        <label>Phone<input name="phone" defaultValue={lead?.phone ?? ""} /></label>
        <label>Customer GSTIN <span className="optional">optional</span><input name="gstin" /></label>
        <label>Customer state<input name="state" placeholder="e.g. West Bengal" /></label>
      </div>
      <label>Billing address<input name="address" /></label>
      <div className="line-items">
        <div className="line-head"><span>Item / service</span><span>HSN/SAC</span><span>Qty</span><span>Rate ₹</span><span>GST %</span><span /></div>
        {items.map((it, n) => (
          <div className="line-row" key={n}>
            <input aria-label="Description" required value={it.description} onChange={(e) => set(n, { description: e.target.value })} />
            <input aria-label="HSN or SAC" value={it.hsn} onChange={(e) => set(n, { hsn: e.target.value })} />
            <input aria-label="Quantity" type="number" min={0.01} step="any" value={it.qty} onChange={(e) => set(n, { qty: Number(e.target.value) })} />
            <input aria-label="Rate" type="number" min={0} step="any" value={it.rate} onChange={(e) => set(n, { rate: Number(e.target.value) })} />
            <select aria-label="GST rate" value={it.gst} onChange={(e) => set(n, { gst: Number(e.target.value) })}>
              {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
            </select>
            <button type="button" className="icon-button" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== n))}><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" className="text-button" onClick={() => setItems([...items, { description: "", hsn: "", qty: 1, rate: 0, gst: 18 }])}><Plus size={13} /> Add line</button>
      </div>
      <div className="form-grid">
        <label>{kind === "quote" ? "Valid until" : "Due date"}<input name="dueDate" type="date" defaultValue={due} /></label>
        <label>Notes <span className="optional">shown on the document</span><input name="notes" /></label>
      </div>
      <p className="doc-sum">Subtotal {inr(sub)} · GST {inr(tax)} · <strong>Total {inr(sub + tax)}</strong></p>
      <div className="modal-actions"><button className="button primary" disabled={busy}>Create {kind === "quote" ? "quotation" : "invoice"}</button></div>
    </form>
  );
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

type Campaign = { id: string; name: string; channel: string; status: string; total: number; sent: number; failed: number; lastError: string | null; createdAt: string };

export function CampaignsView({ notify }: { notify: (m: string) => void }) {
  const { data, reload } = useData<{ campaigns: Campaign[]; whatsapp: boolean }>("/api/sales?view=campaigns", 5_000);
  const { busy, run } = useAction(notify, reload);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const toggle = (s: string) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    void post("/api/sales", { action: "audience", channel, segment: { statuses: next, sources: [] } }).then((r) => setCount(r.count), () => setCount(null));
  };
  return (
    <div className="leads-page">
      <section className="call-top">
        <form
          className="panel settings-card lead-source"
          onSubmit={(e) => {
            e.preventDefault();
            const f = formObj(e.currentTarget);
            if (!confirm(`Send "${f.name}" to ${count ?? "all matching"} lead(s) now?`)) return;
            void run(() => post("/api/sales", { action: "campaign", campaign: { name: f.name, channel, segment: { statuses, sources: [] }, subject: f.subject, body: f.body, template: f.template } }), (r) => `Sending to ${r.total} lead(s)…`);
          }}
        >
          <h3><Send size={16} /> New campaign</h3>
          <div className="form-grid">
            <label>Name<input name="name" required placeholder="Diwali offer" /></label>
            <label>
              Channel
              <select value={channel} onChange={(e) => (setChannel(e.target.value as typeof channel), setCount(null))}>
                <option value="email">Email</option>
                <option value="whatsapp" disabled={!data?.whatsapp}>WhatsApp {data?.whatsapp ? "" : "(not connected)"}</option>
              </select>
            </label>
          </div>
          <p className="hint">Audience — leads in these stages (none ticked = everyone). Opted-out leads are always skipped.</p>
          <div className="lead-owners">
            {stages.map((s) => (
              <label key={s}><input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(s)} /> {s}</label>
            ))}
          </div>
          {count !== null && <p className="hint"><strong>{count}</strong> lead(s) with {channel === "email" ? "an email" : "a phone number"} match.</p>}
          {channel === "email" ? (
            <>
              <label>Subject<input name="subject" required placeholder="{{name}}, a quick idea for your business" /></label>
              <label>Message<textarea name="body" rows={6} required placeholder={"Hi {{name}},\n\n…"} /></label>
            </>
          ) : (
            <>
              <label>Approved template <span className="optional">name or name:language</span><input name="template" required placeholder="diwali_offer:en" /></label>
              <label className="check"><input type="checkbox" name="body" value="{{name}}" /> Template’s {"{{1}}"} is the customer’s first name</label>
            </>
          )}
          <p className="hint">Use {"{{name}}"} for the first name. Email campaigns include an unsubscribe link.</p>
          <div className="lead-actions"><button className="button primary" disabled={busy}><Send size={14} /> Send campaign</button></div>
        </form>
        <Panel title="Campaigns" sub="Progress updates live while a campaign sends.">
          {!data?.campaigns.length ? (
            <Empty>No campaigns yet.</Empty>
          ) : (
            <ul className="call-list">
              {data.campaigns.map((c) => (
                <li key={c.id} className="campaign-row">
                  <div>
                    <strong>{c.name}</strong>
                    <small className="lead-sub">{c.channel === "email" ? "Email" : "WhatsApp"} · {day(c.createdAt)}</small>
                    {c.lastError && <small className="error">{c.lastError}</small>}
                  </div>
                  <span className={`call-badge ${c.status === "Sent" ? "completed" : ""}`}>{c.status}</span>
                  <span className="call-dur">{c.sent}/{c.total}{c.failed ? ` · ${c.failed} failed` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}

// ─── Grievances / support ────────────────────────────────────────────────────

const ticketStatuses = ["Open", "In progress", "Waiting on customer", "Resolved", "Closed"];
type Ticket = { id: string; number: number; customerName: string; phone: string | null; email: string | null; subject: string; description: string; category: string; priority: string; status: string; assigneeId: string | null; assigneeName: string | null; updates: { at: string; by: string; text: string }[]; createdAt: string };

function TicketForm({ defaults, busy, onSubmit }: { defaults?: { customerName: string; phone: string; email: string }; busy: boolean; onSubmit: (t: Record<string, string>) => void }) {
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(formObj(e.currentTarget));
      }}
    >
      <div className="form-grid">
        <label>Customer<input name="customerName" required defaultValue={defaults?.customerName} /></label>
        <label>Phone<input name="phone" defaultValue={defaults?.phone} /></label>
        <label>
          Type
          <select name="category">{["Complaint", "Service request", "Billing", "Feedback", "Other"].map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>
          Priority
          <select name="priority" defaultValue="Medium">{["Low", "Medium", "High", "Urgent"].map((c) => <option key={c}>{c}</option>)}</select>
        </label>
      </div>
      <label>Subject<input name="subject" required /></label>
      <label>Details<textarea name="description" rows={4} required /></label>
      <input type="hidden" name="email" value={defaults?.email ?? ""} />
      <div className="modal-actions"><button className="button primary" disabled={busy}>Log grievance</button></div>
    </form>
  );
}

export function SupportView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{ tickets: Ticket[]; team: { id: string; name: string }[] }>("/api/sales?view=tickets", 20_000);
  const { busy, run } = useAction(notify, reload);
  const [open, setOpen] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("Active");
  const list = (data?.tickets ?? []).filter((t) => filter === "All" || (filter === "Active" ? !["Resolved", "Closed"].includes(t.status) : t.status === filter));
  return (
    <div className="leads-page">
      <Stats
        items={[
          ["Open", (data?.tickets ?? []).filter((t) => t.status === "Open").length],
          ["In progress", (data?.tickets ?? []).filter((t) => t.status === "In progress").length],
          ["Urgent / high", (data?.tickets ?? []).filter((t) => !["Resolved", "Closed"].includes(t.status) && ["High", "Urgent"].includes(t.priority)).length],
          ["Resolved", (data?.tickets ?? []).filter((t) => ["Resolved", "Closed"].includes(t.status)).length],
        ]}
      />
      <Panel
        title="Grievances & support"
        sub="Every concern gets an owner, a status and a written trail until it is resolved."
        actions={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
              {["Active", "All", ...ticketStatuses].map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="button primary" onClick={() => setCreating(true)}><Plus size={15} /> New ticket</button>
          </>
        }
      >
        {!list.length ? (
          <Empty>No tickets here.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead><tr><th>Ticket</th><th>Customer</th><th>Type</th><th>Priority</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <td><button className="text-button" onClick={() => setOpen(t)}><strong>#{t.number} {t.subject}</strong></button><small className="lead-sub">{day(t.createdAt)}</small></td>
                    <td>{t.customerName}<small className="lead-sub">{t.phone}</small></td>
                    <td>{t.category}</td>
                    <td>{t.priority}</td>
                    <td>{t.assigneeName ?? "—"}</td>
                    <td><span className={`call-badge ${["Resolved", "Closed"].includes(t.status) ? "completed" : t.priority === "Urgent" ? "failed" : ""}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && (
        <Modal title="New grievance / support ticket" onClose={() => setCreating(false)} wide>
          <TicketForm busy={busy} onSubmit={(ticket) => void run(() => post("/api/sales", { action: "ticket", ticket }), "Ticket created.").then(() => setCreating(false))} />
        </Modal>
      )}
      {open && (
        <Modal title={`#${open.number} ${open.subject}`} onClose={() => setOpen(null)} wide>
          <p className="modal-intro">{open.customerName} · {open.category} · {open.priority} priority{open.phone ? ` · ${open.phone}` : ""}</p>
          <p className="ticket-desc">{open.description}</p>
          <ol className="ticket-trail">
            {open.updates.map((u, i) => <li key={i}><strong>{u.by}</strong> · {new Date(u.at).toLocaleString("en-IN")}<br />{u.text}</li>)}
          </ol>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              void run(() => post("/api/sales", { action: "ticketUpdate", id: open.id, status: f.status, assigneeId: f.assigneeId || null, note: f.note || undefined }), "Ticket updated.").then(() => setOpen(null));
            }}
          >
            <div className="form-grid">
              <label>Status<select name="status" defaultValue={open.status}>{ticketStatuses.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label>
                Owner
                <select name="assigneeId" defaultValue={open.assigneeId ?? ""} disabled={user.role !== "admin"}>
                  <option value="">Unassigned</option>
                  {data?.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            </div>
            <label>Update / resolution note<textarea name="note" rows={3} /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── AI business assistant ───────────────────────────────────────────────────

export function AssistantView({ notify }: { notify: (m: string) => void }) {
  const [log, setLog] = useState<{ q: string; a: string }[]>([]);
  const { busy, run } = useAction(notify, () => undefined);
  const ask = (q: string) => run(() => post("/api/ai", { action: "ask", question: q }).then((r) => setLog((l) => [{ q, a: r.answer }, ...l])));
  return (
    <div className="leads-page">
      <Panel title="Ask your business" sub="Plain-English questions about leads, pipeline, calls, invoices and support. Answers use only your workspace data.">
        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const q = formObj(f).q?.trim();
            if (q) void ask(q).then(() => f.reset());
          }}
        >
          <Sparkles size={16} />
          <input name="q" placeholder="Which lead source brought the most won deals this quarter?" aria-label="Question" />
          <button className="button primary" disabled={busy}>{busy ? "Thinking…" : "Ask"}</button>
        </form>
        <div className="ask-suggest">
          {["How is our pipeline looking this week?", "Which salesperson converts best?", "Why are we losing deals?", "How much money is outstanding and overdue?"].map((s) => (
            <button key={s} className="text-button" disabled={busy} onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
        {log.map((x, i) => (
          <div className="ai-card ai-answer" key={i}>
            <h4>{x.q}</h4>
            <p>{x.a}</p>
          </div>
        ))}
      </Panel>
    </div>
  );
}
