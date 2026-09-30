"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { PhoneCall, PhoneOff, Loader2, CheckCircle2, AlertCircle, Phone } from "lucide-react";

type Phase = "idle" | "requesting" | "connecting" | "dialing" | "ringing" | "active" | "wrapping_up" | "ended" | "error";

interface EndedCall {
  status: string;
  outcome: string | null;
  duration: number;
  summary: string | null;
  transcript: string | null;
  leadId: string | null;
  failureReason: string | null;
}

const STEPS: { key: Phase; label: string }[] = [
  { key: "connecting", label: "Connecting" },
  { key: "ringing", label: "Ringing" },
  { key: "active", label: "In call" },
  { key: "ended", label: "Ended" },
];

const PHONE_KEY = "rapidx.dialer.phone";
const NAME_KEY = "rapidx.dialer.name";

function stepIndex(p: Phase): number {
  if (p === "dialing") return 0;
  if (p === "wrapping_up") return 3;
  return STEPS.findIndex((s) => s.key === p);
}

function fmtClock(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function CallDialer({ agentRunning, fromNumber }: { agentRunning: boolean; fromNumber: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [ended, setEnded] = useState<EndedCall | null>(null);
  const [talkSeconds, setTalkSeconds] = useState(0);
  const startedAt = useRef<number>(0);
  // Live agent status: the server-rendered value goes stale if the worker restarts while
  // the page is open, which used to leave the Call button disabled for no visible reason.
  const [running, setRunning] = useState(agentRunning);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/agent/status", { cache: "no-store" });
        if (res.ok && alive) setRunning(Boolean((await res.json()).running));
      } catch {
        /* keep last known */
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Remember the last number/name on this browser so "call me" is one click next time.
  useEffect(() => {
    try {
      setPhone(localStorage.getItem(PHONE_KEY) ?? "");
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const busy = phase !== "idle" && phase !== "ended" && phase !== "error";

  const poll = useCallback(async (roomName: string) => {
    try {
      const res = await fetch(`/api/agent/dispatch?room=${encodeURIComponent(roomName)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.logged) {
        setEnded(data as EndedCall);
        setPhase("ended");
        router.refresh();
        return;
      }
      setPhase((prev) => {
        const next = data.phase as Phase;
        // Never step backwards (e.g. room briefly not visible right after dispatch).
        if (next === "wrapping_up" && (prev === "requesting" || prev === "connecting")) return prev;
        return stepIndex(next) >= stepIndex(prev) ? next : prev;
      });
    } catch {
      /* transient — keep polling */
    }
  }, [router]);

  // Poll every 2s while a call is in flight (max ~15 min).
  useEffect(() => {
    if (!room || !busy) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 15 * 60_000) {
        setPhase("error");
        setMessage("Stopped tracking this call after 15 minutes. Check the Calls page for the result.");
        return;
      }
      poll(room);
    }, 2000);
    return () => clearInterval(t);
  }, [room, busy, poll]);

  // Talk timer.
  useEffect(() => {
    if (phase !== "active") return;
    if (!startedAt.current) startedAt.current = Date.now();
    const t = setInterval(() => setTalkSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function call(e: React.FormEvent) {
    e.preventDefault();
    setPhase("requesting");
    setMessage(null);
    setEnded(null);
    setRoom(null);
    setTalkSeconds(0);
    startedAt.current = 0;
    try {
      localStorage.setItem(PHONE_KEY, phone);
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage unavailable */
    }
    try {
      const res = await fetch("/api/agent/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name || undefined, context: context || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setMessage(data.error ?? "Could not start the call.");
        return;
      }
      setRoom(data.roomName);
      setLeadId(data.leadId ?? null);
      setMessage(data.message);
      setPhase("connecting");
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const failed = ended && ended.status !== "completed";
  const current = stepIndex(phase);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <form onSubmit={call} className="space-y-3 lg:col-span-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dial-phone">Your phone number</Label>
            <Input
              id="dial-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              className="h-11 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dial-name">Name (optional)</Label>
            <Input
              id="dial-name"
              placeholder="e.g. Arpan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="h-11 text-base"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dial-context">Briefing for the agent (optional)</Label>
          <Textarea
            id="dial-context"
            rows={2}
            maxLength={1000}
            placeholder="e.g. Asked about WhatsApp automation — clarify requirements and arrange a consultation."
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={busy}
          />
        </div>

        <Button
          type="submit"
          variant="gold"
          size="lg"
          className="h-12 w-full text-base"
          // Never disabled on (possibly stale) agent status: the server re-checks and explains.
          disabled={busy || !phone.trim()}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Call in progress…
            </>
          ) : (
            <>
              <PhoneCall className="size-4" /> Call me now
            </>
          )}
        </Button>
        {!running && (
          <p className="text-xs text-danger-600">The voice agent looks stopped — start it below first.</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Riya will call from {fromNumber || "your Vobiz number"}. Pick up and talk as a buyer or tenant — try asking
          to speak in Hindi, for photos on WhatsApp, or for a human.
        </p>
      </form>

      <div className="rounded-lg border border-border bg-champagne-50 p-4 lg:col-span-2" aria-live="polite">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Call status</div>

        {phase === "idle" && (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <Phone className="size-6 text-gold-700" />
            <p>
              Enter your number and press <b>Call me now</b>.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="flex items-start gap-2 text-sm text-danger-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {message}
          </div>
        )}

        {phase !== "idle" && phase !== "error" && (
          <div className="space-y-4">
            <ol className="flex items-center gap-1">
              {STEPS.map((s, i) => {
                const done = current > i || phase === "ended";
                const active = current === i && phase !== "ended";
                return (
                  <li key={s.key} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className={`h-1.5 w-full rounded-full ${
                        done ? "bg-gold" : active ? "animate-pulse bg-gold/60" : "bg-border"
                      }`}
                    />
                    <span className={`text-[10px] ${done || active ? "font-medium text-espresso" : "text-muted-foreground"}`}>
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {phase !== "ended" && (
              <div className="flex items-center gap-2 text-sm text-espresso">
                {phase === "active" ? (
                  <>
                    <span className="inline-block size-2.5 animate-pulse rounded-full bg-emerald-500" />
                    Talking with Riya · {fmtClock(talkSeconds)}
                  </>
                ) : phase === "wrapping_up" ? (
                  <>
                    <Loader2 className="size-4 animate-spin text-gold-700" /> Call finished — writing the summary…
                  </>
                ) : (
                  <>
                    <Loader2 className="size-4 animate-spin text-gold-700" />
                    {phase === "ringing" ? "Your phone is ringing — pick up!" : message ?? "Connecting…"}
                  </>
                )}
              </div>
            )}

            {phase === "ended" && ended && (
              <div className="space-y-2 text-sm">
                <div className={`flex items-center gap-2 font-medium ${failed ? "text-danger-600" : "text-emerald-700"}`}>
                  {failed ? <PhoneOff className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {failed
                    ? ended.outcome === "busy"
                      ? "Line busy"
                      : ended.outcome === "no_answer"
                        ? "No answer"
                        : "Call could not be connected"
                    : `Call ended · ${fmtClock(ended.duration)}`}
                </div>
                {failed && ended.failureReason && <p className="text-xs text-danger-600">{ended.failureReason}</p>}
                {ended.summary && <p className="text-xs text-espresso-700">{ended.summary}</p>}
                {ended.transcript && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gold-700">Transcript</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 font-sans text-[11px] text-espresso-700">
                      {ended.transcript}
                    </pre>
                  </details>
                )}
                {(ended.leadId ?? leadId) && (
                  <Link href={`/leads/${ended.leadId ?? leadId}`} className="inline-block text-xs text-gold-700 hover:underline">
                    Open lead →
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
