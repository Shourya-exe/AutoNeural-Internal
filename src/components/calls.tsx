"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, PhoneCall, PhoneIncoming, PhoneOutgoing, Play, Square } from "lucide-react";
import type { User } from "@/lib/types";
import { api } from "@/lib/client";

type Call = {
  id: string;
  roomName: string;
  leadName: string | null;
  direction: "inbound" | "outbound";
  customerNumber: string | null;
  status: string;
  outcome: string | null;
  duration: number | null;
  language: string | null;
  summary: string | null;
  sentiment: string | null;
  nextAction: string | null;
  transcript: string | null;
  failureReason: string | null;
  requestedByName: string | null;
  createdAt: string;
  endedAt: string | null;
};
type Agent = { running: boolean; external: boolean; uptime: number | null; error: string | null; missing: string[] };

const post = (payload: Record<string, unknown>) => api<{ message?: string; roomName?: string }>("/api/voice", { body: payload });

/** Ask Riya to phone a lead now. Used from the Leads table. */
export async function callLeadWithAi(leadId: string) {
  return post({ action: "call", leadId });
}

const PHASES: Record<string, string> = {
  connecting: "Starting the agent…",
  dialing: "Dialling…",
  ringing: "Ringing…",
  active: "On the call",
  wrapping_up: "Call ended, writing the summary…",
  ended: "Call finished",
};
const dur = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const label = (c: Call) =>
  !c.endedAt ? "In progress" : c.status === "completed" ? "Answered" : c.status === "missed" ? "No answer" : c.status === "busy" ? "Busy" : "Failed";

export function CallsView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const admin = user.role === "admin";
  const [agent, setAgent] = useState<Agent | null>(null);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ room: string; phase: string; call?: Call } | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const load = useCallback(async () => {
    try {
      const data = await api<{ agent: Agent; calls: Call[] }>("/api/voice");
      setAgent(data.agent);
      setCalls(data.calls);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  // Follow a call placed from the dialer until its summary is stored.
  useEffect(() => {
    if (!live || live.phase === "ended") return;
    const t = setInterval(async () => {
      const data = await api<{ phase: string; call?: Call }>(`/api/voice?room=${encodeURIComponent(live.room)}`).catch(() => null);
      if (!data) return;
      setLive({ room: live.room, phase: data.phase, call: data.call });
      if (data.phase === "ended") void load();
    }, 2500);
    return () => clearInterval(t);
  }, [live, load]);

  const run = async (payload: Record<string, unknown>, after?: (r: { message?: string; roomName?: string }) => void) => {
    setBusy(true);
    try {
      const r = await post(payload);
      if (r.message) notifyRef.current(r.message);
      after?.(r);
      await load();
    } catch (e) {
      notifyRef.current((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const done = (calls ?? []).filter((c) => c.endedAt);
  const today = done.filter((c) => new Date(c.createdAt).toDateString() === new Date().toDateString());

  return (
    <div className="leads-page">
      <section className="stats-grid">
        {[
          ["Calls today", today.length],
          ["Answered today", today.filter((c) => c.status === "completed").length],
          ["Inbound today", today.filter((c) => c.direction === "inbound").length],
          ["Avg. talk time", dur(Math.round(done.reduce((s, c) => s + (c.duration ?? 0), 0) / Math.max(1, done.length)))],
        ].map(([k, v]) => (
          <div className="panel lead-stat" key={k}>
            <small>{k}</small>
            <strong>{v}</strong>
          </div>
        ))}
      </section>

      <section className="call-top">
        <div className="panel settings-card lead-source">
          <h3>
            <Bot size={16} /> Riya, the AI calling agent
            <span className={`agent-dot ${agent?.running ? "on" : ""}`} aria-hidden />
            <small className="agent-state">{agent ? (agent.running ? (agent.external ? "Running on another server" : "Running") : "Stopped") : "…"}</small>
          </h3>
          <p>
            Calls leads over your Vobiz number, answers inbound calls, speaks English, Hindi/Hinglish and Bengali, and writes the
            summary and next step onto the lead’s task when the call ends. New inbound callers become leads automatically.
          </p>
          {agent?.missing.length ? <p className="error">Missing settings: {agent.missing.join(", ")}.</p> : null}
          {agent?.error && <p className="error">{agent.error}</p>}
          {admin && !agent?.external && (
            <div className="lead-actions">
              {agent?.running ? (
                <button className="button" disabled={busy} onClick={() => run({ action: "stop" })}>
                  <Square size={14} /> Stop agent
                </button>
              ) : (
                <button className="button primary" disabled={busy || !!agent?.missing.length} onClick={() => run({ action: "start" })}>
                  <Play size={14} /> Start agent
                </button>
              )}
            </div>
          )}
        </div>

        <form
          className="panel settings-card lead-source"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const d = Object.fromEntries(new FormData(f));
            void run({ action: "call", ...d }, (r) => {
              if (r.roomName) setLive({ room: r.roomName, phase: "connecting" });
              f.reset();
            });
          }}
        >
          <h3>
            <PhoneCall size={16} /> Call a number with AI
          </h3>
          <div className="form-grid">
            <label>
              Phone
              <input name="phone" inputMode="tel" placeholder="+91 98765 43210" required />
            </label>
            <label>
              Name <span className="optional">optional</span>
              <input name="name" maxLength={80} />
            </label>
          </div>
          <label>
            Briefing for Riya <span className="optional">optional</span>
            <input name="context" maxLength={1000} placeholder="e.g. Follow up on the website quote we sent on Monday" />
          </label>
          <div className="lead-actions">
            <button className="button primary" disabled={busy || !agent?.running}>
              <PhoneOutgoing size={14} /> Call now
            </button>
          </div>
          {live && (
            <div className="call-live" role="status">
              <strong>{PHASES[live.phase] ?? live.phase}</strong>
              {live.phase === "ended" && live.call && (
                <p>
                  {label(live.call)} · {dur(live.call.duration)}
                  {live.call.summary ? ` — ${live.call.summary}` : live.call.failureReason ? ` — ${live.call.failureReason}` : ""}
                </p>
              )}
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent calls</h2>
            <p>{admin ? "Every AI call, inbound and outbound." : "AI calls with your leads."} Open a row for the transcript.</p>
          </div>
        </div>
        {error && <p className="error" style={{ padding: "0 22px" }}>{error}</p>}
        {calls === null ? (
          <p className="lead-empty">Loading calls…</p>
        ) : calls.length === 0 ? (
          <p className="lead-empty">No AI calls yet. Use “AI call” on a lead, or call a number above.</p>
        ) : (
          <ul className="call-list">
            {calls.map((c) => (
              <li key={c.id}>
                <details>
                  <summary>
                    {c.direction === "inbound" ? <PhoneIncoming size={15} /> : <PhoneOutgoing size={15} />}
                    <span className="call-who">
                      <strong>{c.leadName || c.customerNumber || "Unknown caller"}</strong>
                      <small>
                        {new Date(c.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                        {c.requestedByName ? ` · by ${c.requestedByName}` : c.direction === "inbound" ? " · inbound" : ""}
                      </small>
                    </span>
                    <span className={`call-badge ${c.status}`}>{label(c)}</span>
                    <span className="call-dur">{dur(c.duration)}</span>
                    <span className="call-sum">{c.summary || c.failureReason || ""}</span>
                  </summary>
                  <div className="call-detail">
                    {c.nextAction && (
                      <p>
                        <strong>Next step:</strong> {c.nextAction}
                      </p>
                    )}
                    {c.language && <p>Language: {c.language}</p>}
                    {c.transcript ? <pre>{c.transcript}</pre> : <p>No transcript for this call.</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
