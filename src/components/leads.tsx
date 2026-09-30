"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Copy, Facebook, KeyRound, MessageCircle, Phone, Plus, RefreshCw, Sheet, Store, Trash2, Webhook } from "lucide-react";
import type { User } from "@/lib/types";
import { api } from "@/lib/client";
import { callLeadWithAi } from "./calls";

const leadStatuses = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"] as const;
type Lead = {
  id: string;
  number: number;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  service: string | null;
  message: string | null;
  city: string | null;
  source: string;
  sourceDetail: string | null;
  status: (typeof leadStatuses)[number];
  ownerId: string | null;
  ownerName: string | null;
  taskId: string | null;
  taskNumber: number | null;
  createdAt: string;
};
type Sources = {
  apiKey: { prefix: string; createdAt: string } | null;
  sheets: { id: string; label: string; host: string; lastPulledAt?: string; lastCount?: number; lastError?: string | null }[];
  indiamart: { lastPulledAt: string | null; lastCount: number | null; lastError: string | null } | null;
  facebook: { configured: boolean; page: { id: string; name: string; connectedAt: string } | null; lastLeadAt: string | null; pending: number; lastError: string | null };
  owners: string[];
};

const call = <T = any>(payload: Record<string, unknown>) => api<T>("/api/leads", { body: payload });

const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-IN");
};
const summary = (r: { created?: number; duplicates?: number; error?: string; skipped?: boolean }) =>
  r.error ?? (r.skipped ? "Checked recently; the next automatic check picks up new leads." : `${r.created ?? 0} new lead(s) loaded${r.duplicates ? `, ${r.duplicates} already here` : ""}.`);

export function LeadsView({
  user,
  team,
  notify,
  onOpenTask,
  onOpenLead,
  onChanged,
}: {
  user: User;
  team: User[];
  notify: (m: string) => void;
  onOpenTask: (taskId: string) => void;
  onOpenLead: (lead: any) => void;
  onChanged: () => void;
}) {
  const admin = user.role === "admin";
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [sources, setSources] = useState<Sources | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Open");
  const [adding, setAdding] = useState(false);
  const newest = useRef<number | null>(null);
  // The parent passes new callback identities each render; keep polling stable.
  const cb = useRef({ notify, onChanged });
  cb.current = { notify, onChanged };

  const load = useCallback(async () => {
    try {
      const data = await api<{ leads: Lead[]; sources: Sources | null }>("/api/leads");
      const top = (data.leads as Lead[])[0]?.number ?? 0;
      if (newest.current !== null && top > newest.current) {
        const fresh = (data.leads as Lead[]).filter((l) => l.number > newest.current!).length;
        cb.current.notify(`${fresh} new lead${fresh === 1 ? "" : "s"} just arrived.`);
        cb.current.onChanged(); // their call tasks now exist too
      }
      newest.current = top;
      setLeads(data.leads);
      setSources(data.sources);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const visible = () => document.visibilityState === "visible" && void load();
    const t = setInterval(visible, 15_000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  const act = async (payload: Record<string, unknown>, done?: (r: any) => void) => {
    try {
      const r = await call(payload);
      done?.(r);
      await load();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const shown = (leads ?? []).filter(
    (l) =>
      (status === "All" || (status === "Open" ? !["Won", "Lost"].includes(l.status) : l.status === status)) &&
      `${l.name} ${l.phone ?? ""} ${l.email ?? ""} ${l.company ?? ""} ${l.service ?? ""} ${l.sourceDetail ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const today = (leads ?? []).filter((l) => new Date(l.createdAt).toDateString() === new Date().toDateString()).length;

  return (
    <div className="leads-page">
      <section className="stats-grid">
        {[
          ["Today", today],
          ["New, not contacted", (leads ?? []).filter((l) => l.status === "New").length],
          ["Qualified", (leads ?? []).filter((l) => l.status === "Qualified").length],
          ["Won", (leads ?? []).filter((l) => l.status === "Won").length],
        ].map(([label, n]) => (
          <div className="panel lead-stat" key={label}>
            <small>{label}</small>
            <strong>{n}</strong>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Leads</h2>
            <p>New leads arrive automatically and become a “Call …” task for the assigned salesperson. This list refreshes every 15 seconds.</p>
          </div>
          <div className="filter-controls">
            <label className="search-box">
              <input placeholder="Search leads" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search leads" />
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {["Open", "All", ...leadStatuses].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button className="button" onClick={() => setAdding((v) => !v)}>
              <Plus size={15} /> Add lead
            </button>
          </div>
        </div>
        {adding && (
          <form
            className="lead-add settings-card"
            onSubmit={(e) => {
              e.preventDefault();
              const lead = Object.fromEntries(new FormData(e.currentTarget));
              void act({ action: "add", lead }, (r) => {
                notify(r.created ? "Lead added and assigned." : "This person is already a lead; noted on their task.");
                setAdding(false);
              });
            }}
          >
            <label>Name<input name="name" required maxLength={120} /></label>
            <label>Phone<input name="phone" inputMode="tel" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Interested in<input name="service" /></label>
            <button className="button primary">Save lead</button>
          </form>
        )}
        {error && <p className="error" style={{ padding: "0 22px" }}>{error}</p>}
        {leads === null ? (
          <p className="lead-empty">Loading leads…</p>
        ) : shown.length === 0 ? (
          <p className="lead-empty">
            {leads.length ? "No leads match this filter." : admin ? "No leads yet. Connect a source below and they will appear here automatically." : "No leads assigned to you yet."}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Contact</th>
                  <th>Source</th>
                  {admin && <th>Owner</th>}
                  <th>Status</th>
                  <th>Received</th>
                  <th><span className="sr-only">Task</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <button className="text-button lead-name" onClick={() => onOpenLead(l)}>
                        <strong>{l.name}</strong>
                      </button>
                      <small className="lead-sub">
                        {[l.service, l.company, l.city].filter(Boolean).join(" · ") || "—"}
                      </small>
                    </td>
                    <td>
                      <div className="lead-contact">
                        {l.phone && (
                          <>
                            <a href={`tel:${l.phone}`} title="Call"><Phone size={13} /> {l.phone}</a>
                            <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label={`WhatsApp ${l.name}`}>
                              <MessageCircle size={13} />
                            </a>
                          </>
                        )}
                        {l.email && <a href={`mailto:${l.email}`}>{l.email}</a>}
                        {l.phone && (
                          <button
                            className="text-button lead-ai-call"
                            title="Riya, the AI agent, calls this lead now and logs the summary on the task"
                            onClick={() =>
                              callLeadWithAi(l.id).then(
                                (r) => notify(r.message ?? "Calling…"),
                                (e: Error) => notify(e.message),
                              )
                            }
                          >
                            <Bot size={13} /> AI call
                          </button>
                        )}
                      </div>
                    </td>
                    <td>{l.sourceDetail || l.source}</td>
                    {admin && <td>{l.ownerName ?? "—"}</td>}
                    <td>
                      <select
                        className="lead-status"
                        data-status={l.status}
                        value={l.status}
                        aria-label={`Status of ${l.name}`}
                        onChange={(e) => void act({ action: "status", id: l.id, status: e.target.value })}
                      >
                        {leadStatuses.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td title={new Date(l.createdAt).toLocaleString("en-IN")}>{ago(l.createdAt)}</td>
                    <td>
                      {l.taskId && (
                        <button className="text-button" onClick={() => onOpenTask(l.taskId!)}>
                          AN-{String(l.taskNumber).padStart(3, "0")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {admin && sources && <SourcesPanel sources={sources} team={team} act={act} notify={notify} />}
    </div>
  );
}

function SourcesPanel({
  sources,
  team,
  act,
  notify,
}: {
  sources: Sources;
  team: User[];
  act: (p: Record<string, unknown>, done?: (r: any) => void) => Promise<void>;
  notify: (m: string) => void;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = typeof window === "undefined" ? "/api/leads/intake" : `${window.location.origin}/api/leads/intake`;
  const fbEndpoint = typeof window === "undefined" ? "/api/facebook/webhook" : `${window.location.origin}/api/facebook/webhook`;
  const fb = sources.facebook;
  const run = async (p: Record<string, unknown>, done?: (r: any) => void) => {
    setBusy(true);
    await act(p, done);
    setBusy(false);
  };
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => notify("Copied."));
  const k = key ?? "YOUR_KEY";
  const curl = `curl -X POST ${endpoint} \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Priya Sharma","phone":"98765 43210","service":"Website","source":"Zapier"}'`;
  const form = `<form action="${endpoint}" method="POST">\n  <input type="hidden" name="key" value="${k}">\n  <input type="hidden" name="_redirect" value="https://autoneural.in/thank-you">\n  <input name="_gotcha" style="display:none" tabindex="-1" autocomplete="off">\n  <input name="name" placeholder="Name" required>\n  <input name="phone" placeholder="Phone" required>\n  <input name="email" placeholder="Email">\n  <textarea name="message" placeholder="How can we help?"></textarea>\n  <button>Send</button>\n</form>`;
  const salespeople = team.filter((u) => u.status !== "INACTIVE");

  return (
    <section className="lead-sources">
      <div className="section-row">
        <h2>Automatic lead sources</h2>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            run({ action: "pull" }, (r) =>
              notify(`Sheets: ${summary(r.sheets)} IndiaMART: ${summary(r.indiamart)}${r.facebook.created ? ` Facebook: ${r.facebook.created} new lead(s).` : ""}`),
            )
          }
        >
          <RefreshCw size={14} /> Check sources now
        </button>
      </div>

      <div className="panel settings-card lead-source">
        <h3><Webhook size={16} /> Website form, Zapier, Meta Lead Ads, any tool</h3>
        <p>
          {sources.apiKey
            ? `Active key ${sources.apiKey.prefix}… created ${ago(sources.apiKey.createdAt)}.`
            : "Create a key, then paste the form or webhook below into your website, Zapier, Make or Pabbly."}
        </p>
        {key && (
          <div className="lead-key">
            <strong>Copy this key now; it will not be shown again.</strong>
            <code>{key}</code>
            <button className="button" onClick={() => copy(key)}><Copy size={14} /> Copy</button>
          </div>
        )}
        <div className="lead-actions">
          <button className="button primary" disabled={busy} onClick={() => run({ action: "rotateKey" }, (r) => setKey(r.key))}>
            <KeyRound size={14} /> {sources.apiKey ? "Rotate key" : "Create key"}
          </button>
          {sources.apiKey && (
            <button className="button" disabled={busy} onClick={() => run({ action: "revokeKey" }, () => setKey(null))}>
              Revoke
            </button>
          )}
        </div>
        <details>
          <summary>Website contact form (paste into autoneural.in or any landing page)</summary>
          <pre>{form}</pre>
          <button className="text-button" onClick={() => copy(form)}>Copy form</button>
        </details>
        <details>
          <summary>Zapier / Make / Pabbly / Meta Lead Ads webhook</summary>
          <p>
            In Zapier: trigger “Facebook Lead Ads → New Lead” (or Google Ads, Typeform, Instamojo…), action “Webhooks → POST” to the URL below with
            the key as a Bearer token. Field names are matched loosely; send <code>externalId</code> to make retries safe.
          </p>
          <pre>{curl}</pre>
          <button className="text-button" onClick={() => copy(curl)}>Copy example</button>
        </details>
      </div>

      <div className="panel settings-card lead-source">
        <h3><Facebook size={16} /> Facebook & Instagram Lead Ads</h3>
        <p>
          {fb.page
            ? `Connected to ${fb.page.name}. Last lead ${ago(fb.lastLeadAt)}.`
            : fb.configured
              ? "Ready. Subscribe your Page so its lead forms arrive here within seconds."
              : "Not connected. Set FACEBOOK_PAGE_ACCESS_TOKEN and the Meta app secret on the server."}
        </p>
        {fb.pending > 0 && (
          <p className="error">
            {fb.pending} lead(s) received but not yet read from Facebook{fb.lastError ? `: ${fb.lastError}` : "."} They are retried automatically.
          </p>
        )}
        <div className="lead-actions">
          <button
            className="button primary"
            disabled={busy || !fb.configured}
            onClick={() => run({ action: "connectFacebook" }, (r) => notify(`${r.name} now sends its leads here.`))}
          >
            {fb.page ? "Re-subscribe Page" : "Subscribe Page"}
          </button>
        </div>
        <details>
          <summary>Webhook setup in Meta</summary>
          <p>
            In your Meta app: Webhooks → Page → callback URL below, verify token <code>FACEBOOK_VERIFY_TOKEN</code> (or the WhatsApp one), subscribe
            to <code>leadgen</code>. Then in Business Settings → Integrations → Leads Access, give this app access to the Page&apos;s leads.
          </p>
          <pre>{fbEndpoint}</pre>
          <button className="text-button" onClick={() => copy(fbEndpoint)}>Copy URL</button>
        </details>
      </div>

      <div className="panel settings-card lead-source">
        <h3><Sheet size={16} /> Google Sheets / CSV</h3>
        <p>
          Facebook lead exports, agency sheets, JustDial or 99acres downloads. Share the sheet as “Anyone with the link can view”. New rows are
          loaded every 2 minutes and never imported twice.
        </p>
        {sources.sheets.map((f) => (
          <div className="lead-feed" key={f.id}>
            <div>
              <strong>{f.label}</strong>
              <small>
                {f.host} · checked {ago(f.lastPulledAt)}
                {f.lastCount ? ` · ${f.lastCount} new last time` : ""}
              </small>
              {f.lastError && <small className="error">{f.lastError}</small>}
            </div>
            <button className="icon-button" aria-label={`Remove ${f.label}`} disabled={busy} onClick={() => run({ action: "removeSheet", id: f.id })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <form
          className="lead-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const d = Object.fromEntries(new FormData(f));
            void run({ action: "addSheet", ...d }, (r) => {
              notify(summary(r));
              f.reset();
            });
          }}
        >
          <label>Name<input name="label" placeholder="Facebook leads" required maxLength={60} /></label>
          <label>Sheet link<input name="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" required /></label>
          <button className="button primary" disabled={busy}>Connect & load</button>
        </form>
      </div>

      <div className="panel settings-card lead-source">
        <h3><Store size={16} /> IndiaMART</h3>
        {sources.indiamart ? (
          <>
            <p>
              Connected. Last pulled {ago(sources.indiamart.lastPulledAt)}
              {sources.indiamart.lastCount != null ? ` · ${sources.indiamart.lastCount} new` : ""}. Checked every 10 minutes.
            </p>
            {sources.indiamart.lastError && <p className="error">{sources.indiamart.lastError}</p>}
            <button className="button" disabled={busy} onClick={() => run({ action: "disconnectIndiaMart" })}>Disconnect</button>
          </>
        ) : (
          <form
            className="lead-inline lead-inline-2"
            onSubmit={(e) => {
              e.preventDefault();
              const apiKey = new FormData(e.currentTarget).get("apiKey");
              void run({ action: "connectIndiaMart", apiKey }, (r) => notify(`IndiaMART connected. ${summary(r)}`));
            }}
          >
            <label>
              CRM API key
              <input name="apiKey" autoComplete="off" required minLength={10} />
            </label>
            <button className="button primary" disabled={busy}>Connect & load 7 days</button>
          </form>
        )}
        <p>Get the key at seller.indiamart.com → Lead Manager → ⋮ → CRM Integration → Generate key.</p>
      </div>

      <div className="panel settings-card lead-source">
        <h3>Who receives new leads</h3>
        <p>Leads rotate between the people ticked here (least recently assigned first). With nobody ticked, all active employees share them.</p>
        <div className="lead-owners">
          {salespeople.map((u) => (
            <label key={u.id}>
              <input
                type="checkbox"
                checked={sources.owners.includes(u.id)}
                disabled={busy}
                onChange={(e) =>
                  run({
                    action: "owners",
                    ids: e.target.checked ? [...sources.owners, u.id] : sources.owners.filter((id) => id !== u.id),
                  })
                }
              />
              {u.name}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
