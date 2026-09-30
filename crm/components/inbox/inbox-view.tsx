"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { channelMeta, DeliveryBadge } from "@/components/domain/badges";
import { AiPanel } from "@/components/inbox/ai-panel";
import { cn } from "@/lib/utils";
import { Search, Send, Lock, CheckCircle2, RotateCcw, Info } from "lucide-react";
import {
  sendReplyAction,
  assignConversationAction,
  setConversationStateAction,
  markConversationReadAction,
} from "@/app/(app)/inbox/actions";

export interface ConvoSummary {
  id: string;
  channel: any;
  contactName: string;
  company: string | null;
  preview: string;
  lastAt: string;
  unread: boolean;
  state: "OPEN" | "RESOLVED";
  assigneeName: string | null;
  assigneeId: string | null;
  leadId: string | null;
}

export interface MessageItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  internal: boolean;
  automated: boolean;
  status: any;
  at: string;
  senderName: string | null;
}

export interface ActiveConvo {
  id: string;
  channel: any;
  contactName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  leadId: string | null;
  leadTitle: string | null;
  stageName: string | null;
  ownerName: string | null;
  value: string;
  assigneeId: string | null;
  state: "OPEN" | "RESOLVED";
  identities: { channel: any; externalId: string }[];
  messages: MessageItem[];
  eligibility: { canSend: boolean; reason?: string };
}

export function InboxView({
  conversations,
  active,
  members,
  currentUserId,
}: {
  conversations: ConvoSummary[];
  active: ActiveConvo | null;
  members: { userId: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const channelFilter = sp.get("channel") ?? "";
  const viewFilter = sp.get("view") ?? "";

  // Restore / persist a per-conversation draft (browser-local).
  useEffect(() => {
    if (!active) return;
    try {
      setDraft(localStorage.getItem(`draft:${active.id}`) ?? "");
    } catch {
      setDraft("");
    }
    if (conversations.find((c) => c.id === active.id)?.unread) {
      markConversationReadAction(active.id).then(() => router.refresh());
    }
  }, [active?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [active?.messages.length]);

  function saveDraft(v: string) {
    setDraft(v);
    if (active) {
      try {
        v ? localStorage.setItem(`draft:${active.id}`, v) : localStorage.removeItem(`draft:${active.id}`);
      } catch {
        /* storage unavailable */
      }
    }
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp);
    value ? next.set(key, value) : next.delete(key);
    router.push(`/inbox?${next.toString()}`);
  }

  const filtered = conversations.filter((c) =>
    query
      ? (c.contactName + " " + (c.company ?? "") + " " + c.preview)
          .toLowerCase()
          .includes(query.toLowerCase())
      : true,
  );

  function send() {
    if (!active || !draft.trim()) return;
    start(async () => {
      setErr(null);
      const res = await sendReplyAction(active.id, draft, internal);
      if (res.ok) {
        saveDraft("");
        router.refresh();
      } else setErr(res.error);
    });
  }

  return (
    <div className="grid h-[calc(100vh-9rem)] grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_290px]">
      {/* ── Column 1: conversation list ── */}
      <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="h-8 w-full rounded-md border border-input bg-ivory pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          <div className="flex gap-1.5">
            <Select
              value={channelFilter}
              onChange={(e) => setParam("channel", e.target.value)}
              className="h-7 text-[11px]"
            >
              <option value="">All channels</option>
              {["WHATSAPP", "MESSENGER", "INSTAGRAM"].map((c) => (
                <option key={c} value={c}>
                  {channelMeta(c).label}
                </option>
              ))}
            </Select>
            <Select
              value={viewFilter}
              onChange={(e) => setParam("view", e.target.value)}
              className="h-7 text-[11px]"
            >
              <option value="">All</option>
              <option value="mine">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              <option value="unread">Unread</option>
              <option value="resolved">Resolved</option>
            </Select>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No conversations match.
            </p>
          )}
          {filtered.map((c) => {
            const Icon = channelMeta(c.channel).icon;
            return (
              <Link
                key={c.id}
                href={`/inbox?c=${c.id}${channelFilter ? `&channel=${channelFilter}` : ""}${viewFilter ? `&view=${viewFilter}` : ""}`}
                className={cn(
                  "flex gap-2.5 border-b border-border px-3 py-2.5 transition-colors hover:bg-champagne-50",
                  active?.id === c.id && "bg-champagne-100",
                )}
              >
                <Avatar name={c.contactName} className="size-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-xs",
                        c.unread ? "font-semibold text-espresso" : "text-espresso-700",
                      )}
                    >
                      {c.contactName}
                    </span>
                    {c.unread && <span className="size-1.5 shrink-0 rounded-full bg-gold" />}
                    <Icon className="ml-auto size-3 shrink-0 text-espresso-300" />
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{c.preview}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{c.lastAt}</span>
                    {c.state === "RESOLVED" && <Badge variant="success">Resolved</Badge>}
                    {!c.assigneeId && <Badge variant="gold">Unassigned</Badge>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Column 2: active conversation ── */}
      <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-card">
        {!active ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
            Select a conversation to view messages.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-espresso">
                  {active.contactName}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {channelMeta(active.channel).label} · {active.company ?? "No company"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Select
                  value={active.assigneeId ?? ""}
                  onChange={(e) =>
                    start(async () => {
                      await assignConversationAction(active.id, e.target.value || null);
                      router.refresh();
                    })
                  }
                  className="h-7 w-auto text-[11px]"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    start(async () => {
                      await setConversationStateAction(
                        active.id,
                        active.state === "OPEN" ? "RESOLVED" : "OPEN",
                      );
                      router.refresh();
                    })
                  }
                >
                  {active.state === "OPEN" ? (
                    <>
                      <CheckCircle2 className="size-3.5" /> Resolve
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-3.5" /> Reopen
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
              {active.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex",
                    m.direction === "OUTBOUND" ? "justify-end" : "justify-start",
                  )}
                >
                  <div className="max-w-[76%]">
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-2 text-xs animate-rise-in",
                        m.internal
                          ? "border border-dashed border-gold-700/40 bg-gold/15 text-espresso-700"
                          : m.direction === "OUTBOUND"
                            ? "rounded-br-md border border-white/10 bg-gradient-to-br from-[#8C1C2B] to-[#5E0D18] text-white shadow-[0_8px_20px_-10px_rgba(140,28,43,0.7)]"
                            : "rounded-bl-md border border-border bg-champagne-100 text-espresso-700",
                      )}
                    >
                      {m.internal && (
                        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gold-700">
                          <Lock className="size-2.5" /> Internal note — not sent to customer
                        </p>
                      )}
                      {m.automated && (
                        <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
                          Automated acknowledgement
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground",
                        m.direction === "OUTBOUND" ? "justify-end" : "justify-start",
                      )}
                    >
                      <span>{m.at}</span>
                      {m.senderName && <span>· {m.senderName}</span>}
                      {m.direction === "OUTBOUND" && !m.internal && (
                        <DeliveryBadge status={m.status} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-border p-3">
              {!active.eligibility.canSend && (
                <p className="mb-2 flex items-start gap-1.5 rounded-md bg-champagne-50 px-2.5 py-2 text-[11px] text-espresso-500">
                  <Info className="mt-px size-3.5 shrink-0 text-gold-700" />
                  {active.eligibility.reason}
                </p>
              )}
              {active.eligibility.canSend && active.eligibility.reason && (
                <p className="mb-2 flex items-start gap-1.5 rounded-md bg-gold/10 px-2.5 py-2 text-[11px] text-gold-700">
                  <Info className="mt-px size-3.5 shrink-0" />
                  {active.eligibility.reason}
                </p>
              )}
              <Textarea
                value={draft}
                onChange={(e) => saveDraft(e.target.value)}
                rows={3}
                placeholder={
                  internal
                    ? "Internal note — visible only to your team."
                    : active.eligibility.canSend
                      ? "Write a reply…"
                      : "Sending is unavailable on this conversation. You can still add an internal note."
                }
                className="text-xs"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-espresso-500">
                  <input
                    type="checkbox"
                    checked={internal}
                    onChange={(e) => setInternal(e.target.checked)}
                    className="accent-gold"
                  />
                  Internal note
                </label>
                <div className="flex items-center gap-2">
                  {draft && (
                    <span className="text-[10px] text-muted-foreground">Draft saved locally</span>
                  )}
                  <Button
                    size="sm"
                    disabled={pending || !draft.trim() || (!internal && !active.eligibility.canSend)}
                    onClick={send}
                  >
                    <Send className="size-3.5" />
                    {internal ? "Add note" : pending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
              {err && <p className="mt-2 text-[11px] text-danger-600">{err}</p>}
            </div>
          </>
        )}
      </div>

      {/* ── Column 3: contact details + quick actions ── */}
      <div className="hidden min-h-0 flex-col gap-3 overflow-y-auto lg:flex">
        {active ? (
          <>
            <div className="rounded-lg border border-border bg-card p-4 shadow-card">
              <div className="flex items-center gap-2.5">
                <Avatar name={active.contactName} className="size-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-espresso">
                    {active.contactName}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {active.company ?? "No company"}
                  </p>
                </div>
              </div>
              <dl className="mt-3 space-y-1.5 text-[11px]">
                <Row label="Phone" value={active.phone} />
                <Row label="Email" value={active.email} />
              </dl>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-card">
              <p className="text-xs font-semibold text-espresso">Opportunity</p>
              {active.leadId ? (
                <>
                  <dl className="mt-2 space-y-1.5 text-[11px]">
                    <Row label="Stage" value={active.stageName} />
                    <Row label="Owner" value={active.ownerName} />
                    <Row label="Value" value={active.value} />
                  </dl>
                  <Link href={`/leads/${active.leadId}`} className="mt-3 block">
                    <Button size="sm" variant="outline" className="w-full">
                      Open lead profile
                    </Button>
                  </Link>
                </>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  No opportunity linked to this conversation.
                </p>
              )}
            </div>

            <AiPanel conversationId={active.id} onUseDraft={(t) => saveDraft(t)} />

            <div className="rounded-lg border border-border bg-card p-4 shadow-card">
              <p className="text-xs font-semibold text-espresso">Channel identities</p>
              <div className="mt-2 space-y-1.5">
                {active.identities.map((i, idx) => (
                  <div key={idx} className="rounded-md border border-border px-2 py-1.5">
                    <p className="text-[11px] text-espresso-700">
                      {channelMeta(i.channel).label}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {i.externalId}
                    </p>
                  </div>
                ))}
                {active.identities.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">None recorded.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Contact details appear here.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-espresso-700">{value || "—"}</dd>
    </div>
  );
}
