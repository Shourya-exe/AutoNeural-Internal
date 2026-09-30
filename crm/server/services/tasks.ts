import { prisma } from "@/lib/prisma";
import { writeActivity } from "./audit";
import { notify } from "./notifications";
import type { Actor } from "@/server/auth/permissions";
import type { Prisma, TaskType, Priority } from "@prisma/client";

export interface CreateTaskInput {
  leadId?: string | null;
  assigneeId?: string | null;
  creatorId?: string | null;
  type?: TaskType;
  title: string;
  description?: string | null;
  priority?: Priority;
  dueAt?: Date | null;
  remindAt?: Date | null;
  /** When set, a task with the same key is created at most once (idempotent). */
  dedupeKey?: string | null;
}

export async function createTask(
  organizationId: string,
  input: CreateTaskInput,
  tx: Prisma.TransactionClient = prisma,
) {
  if (input.dedupeKey) {
    const existing = await tx.task.findUnique({
      where: {
        organizationId_dedupeKey: { organizationId, dedupeKey: input.dedupeKey },
      },
    });
    if (existing) return { task: existing, created: false };
  }

  const task = await tx.task.create({
    data: {
      organizationId,
      leadId: input.leadId ?? null,
      assigneeId: input.assigneeId ?? null,
      creatorId: input.creatorId ?? null,
      type: input.type ?? "FOLLOW_UP",
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "MEDIUM",
      dueAt: input.dueAt ?? null,
      remindAt: input.remindAt ?? null,
      dedupeKey: input.dedupeKey ?? null,
    },
  });

  await writeActivity({
    organizationId,
    leadId: input.leadId ?? null,
    actorUserId: input.creatorId ?? null,
    type: "TASK_CREATED",
    summary: `Task: ${input.title}`,
  });

  if (input.assigneeId) {
    await notify({
      organizationId,
      userId: input.assigneeId,
      type: "TASK_DUE",
      title: `New task: ${input.title}`,
      linkUrl: input.leadId ? `/leads/${input.leadId}` : "/tasks",
    });
  }
  return { task, created: true };
}

export async function completeTask(actor: Actor, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: actor.organizationId },
  });
  if (!task) throw new Error("Task not found.");
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE", completedAt: new Date() },
  });
  await writeActivity({
    organizationId: actor.organizationId,
    leadId: task.leadId,
    actorUserId: actor.id,
    type: "TASK_COMPLETED",
    summary: `Completed task: ${task.title}`,
  });
  return updated;
}

export async function rescheduleTask(actor: Actor, taskId: string, dueAt: Date) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: actor.organizationId },
  });
  if (!task) throw new Error("Task not found.");
  return prisma.task.update({ where: { id: taskId }, data: { dueAt, status: "OPEN" } });
}
