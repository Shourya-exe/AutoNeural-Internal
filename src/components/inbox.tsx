"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircle, Send, Settings2, UserCheck } from "lucide-react";
import type { User } from "@/lib/types";
import { Empty, Modal, formObj, post, useAction, useData } from "./kit";

type Conv = {
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
  lastText: string | null;
  optOut: number | null;
};
type Msg = { id: string; direction: "in" | "out"; body: string; status: string; sender: string | null; error: string | null; createdAt: string };
type Agent = { enabled: boolean; knowledge?: string; maxRepliesPerDay?: number; handoffOnInterest?: boolean };

const when = (d: string) => {
  const t = new Date(d);
  return Date.now() - t.getTime() < 86_400_000 ? t.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function InboxView({ user, notify, onOpenLead }: { user: User; notify: (m: string) => void; onOpenLead: (leadId: string) => void }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const list = useData<{ conversations: Conv[]; connected: boolean; agent: Agent; team: { id: string; name: string }[] }>(`/api/inbox?filter=${filter}&q=${encodeURIComponent(q)}`, 5_000);
  const [openId, setOpenId] = useState<string | null>(null);
  const th = useData<{ conversation: Conv & { windowOpen: boolean }; messages: Msg[] }>(openId ? `/api/inbox?id=${openId}` : null, 4_000);
  const { busy, run } = useAction(notify, () => (list.reload(), th.reload()));
  const [agentOpen, setAgentOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // Block body: scrollIntoView returns a Promise in newer browsers, which React would call as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [th.data?.messages.length]);
  const c = th.data?.conversation;
  const update = (patch: Record<string, unknown>, ok: string) => run(() => post("/api/inbox", { action: "update", id: openId, ...patch }), ok);

  return (
    <div className="leads-page">
      {list.data && !list.data.connected && <p className="filter-notice">WhatsApp isn’t connected on this server. Conversations appear here once the Meta webhook points to /api/whatsapp/webhook.</p>}
      <section className="panel inbox">
        <aside className="inbox-list">
          <div className="inbox-tools">
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
              <option value="all">Open</option>
              <option value="mine">Mine</option>
              <option value="unassigned">Unassigned</option>
              <option value="ai">AI handling</option>
              <option value="closed">Closed</option>
            </select>
            {user.role === "admin" && (
              <button className="icon-button" aria-label="AI agent settings" title="AI agent settings" onClick={() => setAgentOpen(true)}>
                <Settings2 size={16} />
              </button>
            )}
          </div>
          {!list.data?.conversations.length && <Empty>No conversations.</Empty>}
          {list.data?.conversations.map((x) => (
            <button key={x.id} className={`inbox-item ${openId === x.id ? "active" : ""}`} onClick={() => setOpenId(x.id)}>
              <span className="inbox-row">
                <strong>{x.name}</strong>
                <small>{when(x.lastMessageAt)}</small>
              </span>
              <span className="inbox-row">
                <small className="inbox-last">{x.lastText}</small>
                {x.unread > 0 && <span className="nav-count">{x.unread}</span>}
              </span>
              <span className="inbox-tags">
                {x.aiMode ? <em className="tag ai"><Bot size={10} /> AI</em> : null}
                {x.assigneeName ? <em className="tag">{x.assigneeName}</em> : <em className="tag warn">Unassigned</em>}
                {x.leadStatus && <em className="tag">{x.leadStatus}</em>}
              </span>
            </button>
          ))}
        </aside>

        <div className="inbox-thread">
          {!c ? (
            <Empty>
              <MessageCircle size={16} /> Choose a conversation.
            </Empty>
          ) : (
            <>
              <header className="thread-head">
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.phone}{c.optOut ? " · opted out" : ""}</small>
                </div>
                <div className="lead-actions">
                  {c.leadId && <button className="button" onClick={() => onOpenLead(c.leadId!)}>Customer 360</button>}
                  <button className={`button ${c.aiMode ? "primary" : ""}`} disabled={busy} onClick={() => update({ aiMode: !c.aiMode }, c.aiMode ? "AI paused; you’re handling this chat." : "AI agent is handling this chat.")}>
                    <Bot size={14} /> AI {c.aiMode ? "on" : "off"}
                  </button>
                  {c.assigneeId !== user.id && <button className="button" disabled={busy} onClick={() => update({ assigneeId: user.id }, "Assigned to you.")}><UserCheck size={14} /> Take</button>}
                  <button className="button" disabled={busy} onClick={() => update({ status: c.status === "open" ? "closed" : "open" }, c.status === "open" ? "Closed." : "Reopened.")}>{c.status === "open" ? "Close" : "Reopen"}</button>
                </div>
              </header>
              <div className="thread-body">
                {th.data!.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.direction}`}>
                    <p>{m.body}</p>
                    <small>
                      {m.direction === "out" ? `${m.sender ?? ""} · ` : ""}
                      {when(m.createdAt)}
                      {m.direction === "out" ? ` · ${m.status}` : ""}
                      {m.error ? ` · ${m.error}` : ""}
                    </small>
                  </div>
                ))}
                <div ref={end} />
              </div>
              {c.windowOpen ? (
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    const text = formObj(f).text;
                    if (text.trim()) void run(() => post("/api/inbox", { action: "send", id: c.id, text }), undefined).then(() => f.reset());
                  }}
                >
                  <textarea name="text" rows={2} placeholder="Reply… (sending takes over from the AI)" aria-label="Message" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), e.currentTarget.form?.requestSubmit())} />
                  <button className="button primary" disabled={busy}><Send size={14} /> Send</button>
                </form>
              ) : (
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formObj(e.currentTarget);
                    void run(() => post("/api/inbox", { action: "template", id: c.id, template: f.template, params: f.param ? [f.param] : [], category: f.category }), "Template sent.");
                  }}
                >
                  <p className="hint">The 24-hour window is closed — WhatsApp only allows an approved template until the customer replies.</p>
                  <input name="template" required placeholder="template_name or template_name:en" aria-label="Template" />
                  <input name="param" placeholder="{{1}} value (optional)" defaultValue={c.name.split(" ")[0]} aria-label="Template parameter" />
                  <select name="category" aria-label="Category"><option value="utility">Utility</option><option value="marketing">Marketing</option></select>
                  <button className="button primary" disabled={busy}>Send template</button>
                </form>
              )}
            </>
          )}
        </div>
      </section>

      {agentOpen && list.data && (
        <Modal title="AI WhatsApp agent" onClose={() => setAgentOpen(false)} wide>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              void run(
                () => post("/api/inbox", { action: "agent", settings: { enabled: f.enabled === "on", knowledge: f.knowledge, maxRepliesPerDay: Number(f.maxRepliesPerDay), handoffOnInterest: f.handoffOnInterest === "on" } }),
                "AI agent settings saved.",
              ).then(() => setAgentOpen(false));
            }}
          >
            <p className="hint">The agent replies to new WhatsApp chats, qualifies the enquiry into the lead and hands over to a person when the customer is interested or asks for one. It only states facts written below — never prices, discounts or promises that aren’t here.</p>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={list.data.agent.enabled} /> Let the AI agent answer new conversations</label>
            <label className="check"><input type="checkbox" name="handoffOnInterest" defaultChecked={list.data.agent.handoffOnInterest ?? true} /> Hand over to the salesperson as soon as the customer is interested</label>
            <label>Max AI replies per conversation per day<input name="maxRepliesPerDay" type="number" min={1} max={50} defaultValue={list.data.agent.maxRepliesPerDay ?? 8} /></label>
            <label>
              Approved knowledge
              <textarea name="knowledge" rows={12} defaultValue={list.data.agent.knowledge} placeholder={"What we do, services, who they're for, office hours, locations, FAQs.\nOnly write prices here if the AI may quote them exactly."} />
            </label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
