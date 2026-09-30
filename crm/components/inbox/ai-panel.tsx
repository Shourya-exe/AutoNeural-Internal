"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ClipboardPaste } from "lucide-react";

type Task = "summary" | "reply" | "extract" | "next_actions";

const TASKS: { key: Task; label: string }[] = [
  { key: "summary", label: "Summarise" },
  { key: "reply", label: "Suggest reply" },
  { key: "extract", label: "Extract needs" },
  { key: "next_actions", label: "Next actions" },
];

/**
 * Optional AI assistance. Every output is labelled a suggestion, is editable,
 * and is never sent automatically — "Use as draft" only fills the composer, and
 * sending still goes through the normal eligibility checks.
 */
export function AiPanel({
  conversationId,
  onUseDraft,
}: {
  conversationId: string;
  onUseDraft: (text: string) => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Task | null>(null);
  const [result, setResult] = useState<{ task: Task; text?: string; reason?: string } | null>(null);

  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.json())
      .then((d) => setAvailable(!!d.available))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    setResult(null);
  }, [conversationId]);

  async function run(task: Task) {
    setBusy(task);
    setResult(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, task }),
      });
      const data = await res.json();
      setResult({ task, text: data.text, reason: data.reason });
    } catch {
      setResult({ task, reason: "Request failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-espresso">
          <Sparkles className="size-3.5 text-gold-700" /> AI assistance
        </p>
        <Badge variant={available ? "gold" : "muted"}>{available ? "Optional" : "Off"}</Badge>
      </div>

      {available === false ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Not configured. Set <code className="rounded bg-champagne-50 px-1">AI_PROVIDER</code> and{" "}
          <code className="rounded bg-champagne-50 px-1">AI_API_KEY</code> to enable summaries and
          suggested drafts. The CRM works fully without it.
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {TASKS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant="outline"
                disabled={available === null || busy !== null}
                onClick={() => run(t.key)}
                className="text-[11px]"
              >
                {busy === t.key ? "Working…" : t.label}
              </Button>
            ))}
          </div>

          {result && (
            <div className="mt-3 rounded-md border border-dashed border-gold/40 bg-gold/5 p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gold-700">
                AI suggestion — review and edit before use
              </p>
              {result.text ? (
                <>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-espresso-700">
                    {result.text}
                  </p>
                  {result.task === "reply" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 text-[11px]"
                      onClick={() => onUseDraft(result.text!)}
                    >
                      <ClipboardPaste className="size-3" /> Use as draft
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">{result.reason}</p>
              )}
            </div>
          )}

          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Customer messages are treated as data, never as instructions. Nothing is sent
            automatically — a salesperson must approve and send every reply.
          </p>
        </>
      )}
    </div>
  );
}
