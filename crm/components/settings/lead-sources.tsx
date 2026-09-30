"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, RefreshCw, Sheet, Store, Trash2, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  addSheetFeedAction,
  connectIndiaMartAction,
  disconnectLeadSourceAction,
  generateIntakeKeyAction,
  pullNowAction,
  removeSheetFeedAction,
} from "@/app/(app)/settings/lead-sources-actions";

export interface LeadSourcesData {
  sheets: {
    connected: boolean;
    feeds: { id: string; label: string; host: string; lastPulledAt: string | null; lastCount: number | null; lastError: string | null }[];
  };
  indiamart: { connected: boolean; lastPulledAt: string | null; lastCount: number | null; lastError: string | null };
  api: { connected: boolean; keyPrefix: string | null; createdAt: string | null; lastEventAt: string | null; endpoint: string };
}

type Note = { ok: boolean; text: string } | null;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const run = (fn: () => Promise<{ ok: boolean; detail?: string; error?: string; key?: string }>, onOk?: (r: any) => void) =>
    start(async () => {
      const r = await fn();
      setNote({ ok: r.ok, text: (r.ok ? r.detail : r.error) ?? (r.ok ? "Done." : "Failed.") });
      if (r.ok) onOk?.(r);
      router.refresh();
    });
  return { pending, note, run };
}

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p role="status" className={"mt-2 text-[11px] " + (note.ok ? "text-emerald-600" : "text-danger-600")}>
      {note.text}
    </p>
  );
}

function Shell({
  icon: Icon,
  title,
  subtitle,
  connected,
  children,
}: {
  icon: typeof Sheet;
  title: string;
  subtitle: string;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-9 items-center justify-center rounded-md bg-champagne-100 text-gold-700">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-espresso">{title}</p>
            <Badge variant={connected ? "success" : "muted"}>{connected ? "Auto-loading" : "Not connected"}</Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </div>
  );
}

function SheetFeeds({ data }: { data: LeadSourcesData["sheets"] }) {
  const { pending, note, run } = useAction();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  return (
    <Shell
      icon={Sheet}
      title="Google Sheets & CSV feeds"
      subtitle="New rows become leads automatically every few minutes — Facebook lead exports, agency sheets, JustDial/99acres downloads or any published CSV."
      connected={data.connected}
    >
      {data.feeds.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {data.feeds.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-espresso-700">{f.label}</p>
                <p className="text-[10px] text-muted-foreground">
                  {f.host}
                  {f.lastPulledAt ? ` · checked ${f.lastPulledAt}` : " · not checked yet"}
                  {f.lastCount ? ` · ${f.lastCount} new last time` : ""}
                </p>
                {f.lastError && <p className="text-[10px] text-danger-600">{f.lastError}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Remove ${f.label}`}
                onClick={() => run(() => removeSheetFeedAction(f.id))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addSheetFeedAction({ label, url }), () => {
            setLabel("");
            setUrl("");
          });
        }}
      >
        <div>
          <Label htmlFor="feed-label">Name</Label>
          <Input id="feed-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Facebook leads" required maxLength={60} />
        </div>
        <div>
          <Label htmlFor="feed-url">Sheet or CSV link</Label>
          <Input
            id="feed-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Loading…" : "Connect & load"}
        </Button>
      </form>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Share the Google Sheet as <strong>Anyone with the link can view</strong> (or File → Share → Publish to web → CSV).
        The first row must be headers; columns like Name, Phone/Mobile, Email, Company, Service, Message and City are
        matched automatically. Rows without a phone or email are skipped, and a row is never imported twice.
      </p>
      {data.connected && (
        <Button variant="outline" size="sm" className="mt-2" disabled={pending} onClick={() => run(() => pullNowAction("SHEET_FEED"))}>
          <RefreshCw /> Check all sheets now
        </Button>
      )}
      <NoteLine note={note} />
    </Shell>
  );
}

function IndiaMart({ data }: { data: LeadSourcesData["indiamart"] }) {
  const { pending, note, run } = useAction();
  const [key, setKey] = useState("");
  return (
    <Shell
      icon={Store}
      title="IndiaMART Lead Manager"
      subtitle="Direct enquiries, buy-leads, PNS calls and WhatsApp enquiries from IndiaMART are pulled every 10 minutes."
      connected={data.connected}
    >
      {data.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-espresso-600">
            {data.lastPulledAt ? `Last pulled ${data.lastPulledAt}` : "First pull pending"}
            {data.lastCount !== null ? ` · ${data.lastCount} new` : ""}
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => pullNowAction("INDIAMART"))}>
              <RefreshCw /> Pull now
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => disconnectLeadSourceAction("INDIAMART"))}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => connectIndiaMartAction(key), () => setKey(""));
          }}
        >
          <div>
            <Label htmlFor="im-key">CRM API key</Label>
            <Input id="im-key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required minLength={10} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Connecting…" : "Connect & load 7 days"}
          </Button>
        </form>
      )}
      {data.lastError && <p className="mt-2 text-[11px] text-danger-600">{data.lastError}</p>}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Get the key at seller.indiamart.com → Lead Manager → ⋮ → CRM Integration → Generate key (it is emailed to your
        primary address). IndiaMART allows one pull per 5 minutes, so manual pulls are limited to protect the key.
      </p>
      <NoteLine note={note} />
    </Shell>
  );
}

function LeadApi({ data }: { data: LeadSourcesData["api"] }) {
  const { pending, note, run } = useAction();
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  const example = `curl -X POST ${data.endpoint} \\\n  -H "Authorization: Bearer ${key ?? "YOUR_KEY"}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Priya Sharma","phone":"+91 98765 43210","service":"Website","source":"Zapier"}'`;
  return (
    <Shell
      icon={Webhook}
      title="Lead intake API"
      subtitle="Let Zapier, Pabbly, Make, landing-page builders or your own scripts add leads automatically."
      connected={data.connected}
    >
      {key && (
        <div className="mb-3 rounded-md border border-gold/40 bg-gold/10 p-3">
          <p className="text-[11px] font-medium text-gold-700">Copy this key now — it will not be shown again.</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 text-[11px]">{key}</code>
            <Button variant="outline" size="sm" onClick={() => copy(key, "key")}>
              {copied === "key" ? <Check /> : <Copy />} Copy
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-espresso-600">
          {data.connected
            ? `Active key ${data.keyPrefix}… created ${data.createdAt}${data.lastEventAt ? ` · last lead ${data.lastEventAt}` : ""}`
            : "No key yet."}
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" disabled={pending} onClick={() => run(() => generateIntakeKeyAction(), (r) => setKey(r.key))}>
            <KeyRound /> {data.connected ? "Rotate key" : "Create key"}
          </Button>
          {data.connected && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => disconnectLeadSourceAction("LEAD_API"))}>
              Revoke
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Example</p>
          <Button variant="ghost" size="sm" onClick={() => copy(example, "example")}>
            {copied === "example" ? <Check /> : <Copy />}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-champagne-100 p-2 text-[10px] leading-relaxed text-espresso-700">{example}</pre>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Send one lead or <code>{"{ \"leads\": [...] }"}</code> (up to 100). Field names are matched loosely, so most
          tools can post their own payload. Add <code>externalId</code> to make retries safe.
        </p>
      </div>
      <NoteLine note={note} />
    </Shell>
  );
}

export function LeadSources({ data }: { data: LeadSourcesData }) {
  return (
    <div className="space-y-3">
      <SheetFeeds data={data.sheets} />
      <IndiaMart data={data.indiamart} />
      <LeadApi data={data.api} />
    </div>
  );
}
