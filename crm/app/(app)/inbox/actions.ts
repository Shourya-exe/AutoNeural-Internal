"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireActor, requireCan } from "@/server/auth/context";
import { sendReply, sendEligibility } from "@/server/services/conversations";

type Result = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): Result => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong.",
});

export async function sendReplyAction(
  conversationId: string,
  body: string,
  asInternalNote: boolean,
): Promise<Result> {
  try {
    const actor = await requireActor();
    requireCan(actor, "inbox.send");
    if (!body.trim()) throw new Error("Message is empty.");
    await sendReply(actor, conversationId, body.trim(), { asInternalNote });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function assignConversationAction(
  conversationId: string,
  assigneeId: string | null,
): Promise<Result> {
  try {
    const actor = await requireActor();
    const convo = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: actor.organizationId },
    });
    if (!convo) throw new Error("Conversation not found.");
    await prisma.conversation.update({ where: { id: conversationId }, data: { assigneeId } });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setConversationStateAction(
  conversationId: string,
  state: "OPEN" | "RESOLVED",
): Promise<Result> {
  try {
    const actor = await requireActor();
    const convo = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: actor.organizationId },
    });
    if (!convo) throw new Error("Conversation not found.");
    await prisma.conversation.update({ where: { id: conversationId }, data: { state } });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function markConversationReadAction(conversationId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await prisma.conversation.updateMany({
      where: { id: conversationId, organizationId: actor.organizationId },
      data: { unread: false },
    });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function checkSendEligibilityAction(conversationId: string) {
  const actor = await requireActor();
  return sendEligibility(actor.organizationId, conversationId);
}
