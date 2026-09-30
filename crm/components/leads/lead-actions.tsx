"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select, Textarea, Input, Label } from "@/components/ui/input";
import {
  UserPlus,
  StickyNote,
  CalendarClock,
  GitBranch,
  MessageSquare,
  Archive,
  PhoneCall,
} from "lucide-react";
import {
  assignLeadAction,
  addNoteAction,
  scheduleFollowUpAction,
  changeStageAction,
  archiveLeadAction,
} from "@/app/(app)/leads/actions";

type Mode = null | "assign" | "note" | "followup" | "stage";

export function LeadActions({
  leadId,
  ownerId,
  stageId,
  archived,
  conversationId,
  members,
  stages,
  canAssignOthers,
  canArchive,
  phone,
}: {
  leadId: string;
  ownerId: string | null;
  stageId: string;
  archived: boolean;
  conversationId: string | null;
  members: { userId: string; name: string }[];
  stages: { id: string; name: string; isLost: boolean }[];
  canAssignOthers: boolean;
  canArchive: boolean;
  /** The contact's phone number; enables "Call with AI". */
  phone?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [owner, setOwner] = useState(ownerId ?? "");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(defaultDue());
  const [followTitle, setFollowTitle] = useState("Follow up");
  const [toStage, setToStage] = useState(stageId);
  const [reason, setReason] = useState("");

  const [calling, setCalling] = useState(false);
  const [callMsg, setCallMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function callWithAi() {
    if (!phone || !window.confirm(`Have the AI voice agent call ${phone} now?`)) return;
    setCalling(true);
    setCallMsg(null);
    try {
      const res = await fetch("/api/agent/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json().catch(() => ({}));
      setCallMsg({ ok: res.ok, text: data.message ?? data.error ?? "Call request failed" });
      if (res.ok) router.refresh();
    } catch (e) {
      setCallMsg({ ok: false, text: e instanceof Error ? e.message : "Call request failed" });
    } finally {
      setCalling(false);
    }
  }

  const lostSelected = stages.find((s) => s.id === toStage)?.isLost ?? false;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setErr(null);
      const res = await fn();
      if (res.ok) {
        setMode(null);
        router.refresh();
      } else setErr(res.error ?? "Failed");
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setMode("assign")}>
          <UserPlus className="size-3.5" /> Assign
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("note")}>
          <StickyNote className="size-3.5" /> Add note
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("followup")}>
          <CalendarClock className="size-3.5" /> Schedule follow-up
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("stage")}>
          <GitBranch className="size-3.5" /> Change stage
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={callWithAi}
          disabled={!phone || calling}
          title={phone ? `AI voice agent calls ${phone}` : "No phone number on this contact"}
        >
          <PhoneCall className="size-3.5" /> {calling ? "Dialing…" : "Call with AI"}
        </Button>
        {conversationId ? (
          <a href={`/inbox?c=${conversationId}`}>
            <Button size="sm" variant="gold">
              <MessageSquare className="size-3.5" /> Open conversation
            </Button>
          </a>
        ) : (
          <Button size="sm" variant="ghost" disabled title="No messaging conversation on this lead">
            <MessageSquare className="size-3.5" /> No conversation
          </Button>
        )}
        {canArchive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => archiveLeadAction(leadId, !archived))}
          >
            <Archive className="size-3.5" /> {archived ? "Restore" : "Archive"}
          </Button>
        )}
      </div>
      {callMsg && (
        <p className={`mt-2 text-xs ${callMsg.ok ? "text-muted-foreground" : "text-danger-600"}`}>{callMsg.text}</p>
      )}

      <Dialog open={mode === "assign"} onClose={() => setMode(null)} title="Assign lead">
        <div className="space-y-3">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
          {!canAssignOthers && (
            <p className="text-[11px] text-muted-foreground">
              Your role can only assign leads to yourself. Ask a Manager to reassign.
            </p>
          )}
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => run(() => assignLeadAction(leadId, owner || null))}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Dialog>

      <Dialog open={mode === "note"} onClose={() => setMode(null)} title="Add note">
        <div className="space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal note — never sent to the customer."
            rows={5}
          />
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <Button
            className="w-full"
            disabled={pending || !note.trim()}
            onClick={() => run(() => addNoteAction(leadId, note))}
          >
            {pending ? "Saving…" : "Add note"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={mode === "followup"}
        onClose={() => setMode(null)}
        title="Schedule follow-up"
        description="Stored in UTC, displayed in Asia/Kolkata."
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={followTitle} onChange={(e) => setFollowTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Due</Label>
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => run(() => scheduleFollowUpAction(leadId, due, followTitle))}
          >
            {pending ? "Saving…" : "Schedule"}
          </Button>
        </div>
      </Dialog>

      <Dialog open={mode === "stage"} onClose={() => setMode(null)} title="Change stage">
        <div className="space-y-3">
          <Select value={toStage} onChange={(e) => setToStage(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {lostSelected && (
            <div className="space-y-1">
              <Label>Reason for loss (required)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Chose a competitor"
              />
            </div>
          )}
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <Button
            className="w-full"
            disabled={pending || (lostSelected && !reason.trim())}
            onClick={() => run(() => changeStageAction(leadId, toStage, reason))}
          >
            {pending ? "Saving…" : "Move"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function defaultDue() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
