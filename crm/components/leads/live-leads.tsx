"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

const POLL_MS = 15_000;

/**
 * Surfaces leads that arrive (webhooks, sheet feeds, IndiaMART, API) while the
 * list is open. Polls only while the tab is visible, and never reshuffles the
 * table under the user: it shows a banner, and the user chooses when to load.
 */
export function LiveLeads({ since }: { since: string }) {
  const router = useRouter();
  const [news, setNews] = useState<{ count: number; latest: { id: string; name: string; source: string }[] } | null>(null);
  const sinceRef = useRef(since);
  sinceRef.current = since; // a server refresh passes a new render time

  useEffect(() => {
    setNews(null);
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/leads/latest?since=${encodeURIComponent(sinceRef.current)}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const data = await res.json();
        setNews(data.count > 0 ? data : null);
      } catch {
        /* offline: try again next tick */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [since]);

  if (!news) return null;
  const who = news.latest.map((l) => `${l.name} (${l.source})`).join(", ");
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      aria-live="polite"
      className="flex w-full items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-left text-xs text-gold-700 transition-colors hover:bg-gold/20"
    >
      <Sparkles className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <strong>
          {news.count} new lead{news.count === 1 ? "" : "s"}
        </strong>{" "}
        arrived — {who}
        {news.count > news.latest.length ? " and more" : ""}
      </span>
      <span className="shrink-0 font-semibold underline underline-offset-2">Show</span>
    </button>
  );
}
