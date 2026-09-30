"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, RefreshCw, Activity } from "lucide-react";

interface AgentStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  healthPort: number;
  error: string | null;
}

export function AgentControl({
  configured,
  livekitUrl,
  llmProvider,
  voice,
}: {
  configured: boolean;
  livekitUrl: string;
  llmProvider: string;
  voice: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/status", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function control(action: "start" | "stop") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/agent/${action}`, { method: "POST" });
      const data = await res.json();
      setMessage(data.message ?? data.error ?? null);
      await refresh();
      router.refresh(); // re-enable/disable the dialer
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2.5 rounded-full ${running ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`}
          />
          <span className="text-sm font-medium text-espresso">
            {running ? "Agent running" : "Agent stopped"}
          </span>
        </div>
        <Badge variant={configured ? "success" : "muted"}>
          {configured ? "LiveKit configured" : "LiveKit not configured"}
        </Badge>
        {status?.pid && <span className="text-xs text-muted-foreground">PID {status.pid}</span>}
        {status?.uptime != null && <span className="text-xs text-muted-foreground">up {status.uptime}s</span>}

        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {running ? (
            <Button size="sm" variant="danger" onClick={() => control("stop")} disabled={busy}>
              <Square className="size-3.5" /> Stop agent
            </Button>
          ) : (
            <Button size="sm" variant="gold" onClick={() => control("start")} disabled={busy || !configured}>
              <Play className="size-3.5" /> Start agent
            </Button>
          )}
        </div>
      </div>

      {message && (
        <p className="rounded-md bg-champagne-50 px-3 py-2 text-xs text-espresso-700">{message}</p>
      )}
      {status?.error && (
        <p className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-600">{status.error}</p>
      )}
      {!configured && (
        <p className="rounded-md bg-champagne-50 px-3 py-2 text-xs text-espresso-700">
          Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in <code>.env</code>, then install the
          Python worker: <code>pip install -r requirements.txt</code>.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        <Meta label="LiveKit" value={livekitUrl || "—"} />
        <Meta label="LLM" value={llmProvider} />
        <Meta label="Voice" value={voice} />
        <Meta label="Health port" value={String(status?.healthPort ?? "—")} />
      </dl>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-espresso-700">{value}</dd>
    </div>
  );
}

export { Activity };