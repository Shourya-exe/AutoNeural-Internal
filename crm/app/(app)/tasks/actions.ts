"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/context";
import { createTask, completeTask, rescheduleTask } from "@/server/services/tasks";

type Result = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): Result => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong.",
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  leadId: z.string().optional(),
  assigneeId: z.string().optional(),
  type: z.enum(["FOLLOW_UP", "CALL", "DEMO_PREP", "GENERIC"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueAt: z.string().optional(),
});

export async function createTaskAction(input: unknown): Promise<Result> {
  try {
    const actor = await requireActor();
    const data = createSchema.parse(input);
    await createTask(actor.organizationId, {
      title: data.title,
      description: data.description || null,
      leadId: data.leadId || null,
      assigneeId: data.assigneeId || actor.id,
      creatorId: actor.id,
      type: data.type,
      priority: data.priority,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      remindAt: data.dueAt ? new Date(data.dueAt) : null,
    });
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function completeTaskAction(taskId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await completeTask(actor, taskId);
    revalidatePath("/tasks");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function rescheduleTaskAction(taskId: string, dueAt: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await rescheduleTask(actor, taskId, new Date(dueAt));
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reassignTaskAction(taskId: string, assigneeId: string | null): Promise<Result> {
  try {
    const actor = await requireActor();
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: actor.organizationId },
    });
    if (!task) throw new Error("Task not found.");
    await prisma.task.update({ where: { id: taskId }, data: { assigneeId } });
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
