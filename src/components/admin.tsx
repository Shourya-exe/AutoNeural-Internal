"use client";
import { useState } from "react";
import { Empty, Panel, Stats, formObj, inr, post, useAction, useData } from "./kit";

type Rates = { effectiveFrom: string; voicePerMinute: number | null; aiCredit: number | null; waMarketing: number | null; waUtility: number | null; waService: number | null };
const LABEL: Record<string, string> = {
  ai_credit: "AI credits",
  voice_minute: "Voice minutes",
  whatsapp_marketing: "WhatsApp · marketing",
  whatsapp_utility: "WhatsApp · utility",
  whatsapp_service: "WhatsApp · service replies",
  email: "Emails",
};
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function UsageView({ notify }: { notify: (m: string) => void }) {
  const [month, setMonth] = useState(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
  const { data, reload } = useData<{
    rows: { kind: string; feature: string; quantity: number; events: number; unit: number | null; cost: number | null }[];
    rates: Rates;
    rateCards: Rates[];
    budgets: { aiCreditsPerMonth: number | null; voiceMinutesPerMonth: number | null };
  }>(`/api/usage?month=${month}`, 30_000);
  const { busy, run } = useAction(notify, reload);
  const total = (kind: string) => (data?.rows ?? []).filter((r) => r.kind === kind).reduce((a, r) => a + r.quantity, 0);
  const cost = (data?.rows ?? []).reduce((a, r) => a + (r.cost ?? 0), 0);
  const unpriced = (data?.rows ?? []).some((r) => r.cost == null);
  return (
    <div className="leads-page">
      <Stats
        items={[
          ["AI credits", `${total("ai_credit")}${data?.budgets.aiCreditsPerMonth != null ? ` / ${data.budgets.aiCreditsPerMonth}` : ""}`],
          ["Voice minutes", `${total("voice_minute")}${data?.budgets.voiceMinutesPerMonth != null ? ` / ${data.budgets.voiceMinutesPerMonth}` : ""}`],
          ["WhatsApp messages", total("whatsapp_marketing") + total("whatsapp_utility") + total("whatsapp_service")],
          ["Estimated variable cost", `${inr(cost)}${unpriced ? "+" : ""}`],
        ]}
      />
      <Panel title="Usage this month" sub="Every AI call, AI credit and WhatsApp message is metered. Meta’s WhatsApp charges are billed by Meta per delivered message." actions={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}>
        {!data?.rows.length ? (
          <Empty>No metered usage this month.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead><tr><th>Meter</th><th>Used by</th><th>Quantity</th><th>Rate</th><th>Cost</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.kind}-${r.feature}`}>
                    <td><strong>{LABEL[r.kind] ?? r.kind}</strong></td>
                    <td>{r.feature.replace(/_/g, " ")}</td>
                    <td>{r.quantity}</td>
                    <td>{r.unit == null ? "not set" : inr(r.unit)}</td>
                    <td>{r.cost == null ? "—" : inr(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <section className="call-top">
        <form
          className="panel settings-card lead-source"
          onSubmit={(e) => {
            e.preventDefault();
            const f = formObj(e.currentTarget);
            void run(() => post("/api/usage", { action: "budgets", budgets: { aiCreditsPerMonth: num(f.ai), voiceMinutesPerMonth: num(f.voice) } }), "Budgets saved.");
          }}
        >
          <h3>Monthly budgets</h3>
          <p>AI features and AI calls stop for the month when a budget is reached. Leave blank for no cap.</p>
          <div className="form-grid">
            <label>AI credits<input name="ai" type="number" min={0} defaultValue={data?.budgets.aiCreditsPerMonth ?? ""} key={`a${data?.budgets.aiCreditsPerMonth}`} /></label>
            <label>AI voice minutes<input name="voice" type="number" min={0} defaultValue={data?.budgets.voiceMinutesPerMonth ?? ""} key={`v${data?.budgets.voiceMinutesPerMonth}`} /></label>
          </div>
          <div className="lead-actions"><button className="button primary" disabled={busy}>Save budgets</button></div>
        </form>
        <form
          className="panel settings-card lead-source"
          onSubmit={(e) => {
            e.preventDefault();
            const f = formObj(e.currentTarget);
            void run(
              () => post("/api/usage", { action: "rates", rates: { effectiveFrom: f.effectiveFrom, voicePerMinute: num(f.voicePerMinute), aiCredit: num(f.aiCredit), waMarketing: num(f.waMarketing), waUtility: num(f.waUtility), waService: num(f.waService) } }),
              "Rate card saved.",
            );
          }}
        >
          <h3>Rate card (₹)</h3>
          <p>Enter what you actually pay: telecom + voice AI per minute, and Meta’s current WhatsApp rates for India. Each card is kept with its start date, so past months stay priced correctly.</p>
          <div className="form-grid" key={data?.rates.effectiveFrom}>
            <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Voice / minute<input name="voicePerMinute" type="number" step="0.01" min={0} defaultValue={data?.rates.voicePerMinute ?? ""} /></label>
            <label>AI credit<input name="aiCredit" type="number" step="0.01" min={0} defaultValue={data?.rates.aiCredit ?? ""} /></label>
            <label>WhatsApp marketing<input name="waMarketing" type="number" step="0.0001" min={0} defaultValue={data?.rates.waMarketing ?? ""} /></label>
            <label>WhatsApp utility<input name="waUtility" type="number" step="0.0001" min={0} defaultValue={data?.rates.waUtility ?? ""} /></label>
            <label>WhatsApp service<input name="waService" type="number" step="0.0001" min={0} defaultValue={data?.rates.waService ?? 0} /></label>
          </div>
          {!!data?.rateCards.length && <p className="hint">Saved cards: {data.rateCards.map((r) => r.effectiveFrom).sort().join(", ")}</p>}
          <div className="lead-actions"><button className="button primary" disabled={busy}>Save rate card</button></div>
        </form>
      </section>
    </div>
  );
}

export function AuditView() {
  const { data } = useData<{ events: { id: string; actor: string; action: string; entity: string | null; entityId: string | null; detail: string | null; createdAt: string }[] }>("/api/usage?view=audit", 30_000);
  const [q, setQ] = useState("");
  const rows = (data?.events ?? []).filter((e) => `${e.actor} ${e.action} ${e.detail ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="leads-page">
      <Panel title="Audit log" sub="Sensitive actions, every automation and every AI action — who, what and when." actions={<input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />}>
        {!rows.length ? (
          <Empty>No audit events yet.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td><strong>{e.actor}</strong></td>
                    <td>{e.action}</td>
                    <td className="wrap"><small>{e.detail?.slice(0, 240)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
