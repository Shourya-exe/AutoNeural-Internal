import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, isOverdue } from "@/lib/datetime";
import { TaskList, NewTaskButton, type TaskItem } from "@/components/tasks/task-list";
import { cn } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Completed" },
] as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; mine?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;
  const view = (sp.view ?? "today") as (typeof VIEWS)[number]["key"];
  const mine = sp.mine !== "0";

  const now = new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const base: Prisma.TaskWhereInput = {
    organizationId: actor.organizationId,
    ...(mine ? { assigneeId: actor.id } : {}),
  };

  const where: Prisma.TaskWhereInput =
    view === "today"
      ? { ...base, status: "OPEN", dueAt: { gte: now, lte: endOfToday } }
      : view === "upcoming"
        ? { ...base, status: "OPEN", dueAt: { gt: endOfToday } }
        : view === "overdue"
          ? { ...base, status: "OPEN", dueAt: { lt: now } }
          : { ...base, status: "DONE" };

  const [tasks, members, counts] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: view === "done" ? { completedAt: "desc" } : { dueAt: "asc" },
      take: 200,
      include: { assignee: true, lead: { include: { contact: true } } },
    }),
    prisma.membership.findMany({
      where: { organizationId: actor.organizationId },
      include: { user: true },
    }),
    Promise.all([
      prisma.task.count({
        where: { ...base, status: "OPEN", dueAt: { gte: now, lte: endOfToday } },
      }),
      prisma.task.count({ where: { ...base, status: "OPEN", dueAt: { gt: endOfToday } } }),
      prisma.task.count({ where: { ...base, status: "OPEN", dueAt: { lt: now } } }),
      prisma.task.count({ where: { ...base, status: "DONE" } }),
    ]),
  ]);

  const items: TaskItem[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    priority: t.priority,
    status: t.status,
    dueAtLabel: t.dueAt ? fmtDateTime(t.dueAt) : "No due date",
    overdue: isOverdue(t.dueAt),
    assigneeName: t.assignee?.name ?? null,
    leadId: t.leadId,
    leadName: t.lead?.contact.fullName ?? null,
  }));

  const countByView: Record<string, number> = {
    today: counts[0],
    upcoming: counts[1],
    overdue: counts[2],
    done: counts[3],
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-espresso">Tasks &amp; follow-ups</h1>
          <p className="text-xs text-muted-foreground">
            Due dates are stored in UTC and shown in Asia/Kolkata.
          </p>
        </div>
        <NewTaskButton members={members.map((m) => ({ userId: m.userId, name: m.user.name }))} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-sm">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/tasks?view=${v.key}&mine=${mine ? "1" : "0"}`}
              className={cn(
                "rounded-[6px] px-3 py-1 text-xs font-medium transition-colors",
                view === v.key
                  ? "bg-champagne-200 text-espresso"
                  : "text-espresso-500 hover:text-espresso-700",
              )}
            >
              {v.label}
              <span
                className={cn(
                  "ml-1.5 tabular-nums",
                  v.key === "overdue" && countByView.overdue > 0
                    ? "text-danger-600"
                    : "text-muted-foreground",
                )}
              >
                {countByView[v.key]}
              </span>
            </Link>
          ))}
        </div>
        <Link
          href={`/tasks?view=${view}&mine=${mine ? "0" : "1"}`}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-espresso-500 hover:text-espresso-700"
        >
          {mine ? "Showing: assigned to me" : "Showing: whole team"} — switch
        </Link>
      </div>

      <TaskList
        tasks={items}
        members={members.map((m) => ({ userId: m.userId, name: m.user.name }))}
        emptyLabel={
          view === "overdue"
            ? "Nothing overdue. Good."
            : view === "done"
              ? "No completed tasks yet."
              : "No tasks in this view."
        }
      />
    </div>
  );
}
