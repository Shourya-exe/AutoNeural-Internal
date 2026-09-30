"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Check, Clock, Plus, UserCog } from "lucide-react";
import {
  completeTaskAction,
  rescheduleTaskAction,
  reassignTaskAction,
  createTaskAction,
} from "@/app/(app)/tasks/actions";

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  dueAtLabel: string;
  overdue: boolean;
  assigneeName: string | null;
  leadId: string | null;
  leadName: string | null;
}

export function TaskList({
  tasks,
  members,
  emptyLabel,
}: {
  tasks: TaskItem[];
  members: { userId: string; name: string }[];
  emptyLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reschedule, setReschedule] = useState<TaskItem | null>(null);
  const [reassign, setReassign] = useState<TaskItem | null>(null);
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      await fn();
      setReschedule(null);
      setReassign(null);
      router.refresh();
    });
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-card"
          >
            <button
              onClick={() => run(() => completeTaskAction(t.id))}
              disabled={pending || t.status === "DONE"}
              className={
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors " +
                (t.status === "DONE"
                  ? "border-emerald bg-emerald text-white"
                  : "border-espresso-300 hover:border-gold hover:bg-gold/10")
              }
              aria-label="Complete task"
            >
              {t.status === "DONE" && <Check className="size-3" />}
            </button>

            <div className="min-w-0 flex-1">
              <p
                className={
                  "text-sm " +
                  (t.status === "DONE"
                    ? "text-muted-foreground line-through"
                    : "text-espresso-700")
                }
              >
                {t.title}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t.leadId ? (
                  <Link href={`/leads/${t.leadId}`} className="hover:text-gold-700 hover:underline">
                    {t.leadName}
                  </Link>
                ) : (
                  "No linked lead"
                )}
                {" · "}
                {t.assigneeName ?? "Unassigned"}
                {t.description ? ` · ${t.description}` : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant={t.overdue && t.status === "OPEN" ? "danger" : "muted"}>
                {t.overdue && t.status === "OPEN" ? "Overdue · " : ""}
                {t.dueAtLabel}
              </Badge>
              <Badge variant={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "gold" : "outline"}>
                {t.priority[0] + t.priority.slice(1).toLowerCase()}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                title="Reschedule"
                onClick={() => {
                  setReschedule(t);
                  setDue(defaultDue());
                }}
              >
                <Clock className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Reassign"
                onClick={() => {
                  setReassign(t);
                  setAssignee("");
                }}
              >
                <UserCog className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!reschedule} onClose={() => setReschedule(null)} title="Reschedule task">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>New due date &amp; time (Asia/Kolkata)</Label>
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={pending || !due}
            onClick={() => reschedule && run(() => rescheduleTaskAction(reschedule.id, due))}
          >
            Save
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!reassign} onClose={() => setReassign(null)} title="Reassign task">
        <div className="space-y-3">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => reassign && run(() => reassignTaskAction(reassign.id, assignee || null))}
          >
            Save
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function NewTaskButton({ members }: { members: { userId: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> New task
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New task">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            start(async () => {
              setErr(null);
              const res = await createTaskAction(Object.fromEntries(fd.entries()));
              if (res.ok) {
                setOpen(false);
                router.refresh();
              } else setErr(res.error);
            });
          }}
        >
          <div className="space-y-1">
            <Label>Title</Label>
            <Input name="title" required placeholder="Call Vikram about the proposal" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea name="description" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select name="type" defaultValue="FOLLOW_UP">
                <option value="FOLLOW_UP">Follow-up</option>
                <option value="CALL">Call</option>
                <option value="DEMO_PREP">Demo prep</option>
                <option value="GENERIC">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select name="priority" defaultValue="MEDIUM">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Assign to</Label>
              <Select name="assigneeId" defaultValue="">
                <option value="">Me</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Due</Label>
              <Input type="datetime-local" name="dueAt" defaultValue={defaultDue()} />
            </div>
          </div>
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating…" : "Create task"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}

function defaultDue() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
