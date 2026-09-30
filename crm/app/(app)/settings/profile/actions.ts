"use server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/context";

export async function changePassword(form: FormData): Promise<{ ok: boolean; message: string }> {
  const actor = await requireActor();
  const current = String(form.get("currentPassword") ?? "");
  const next = String(form.get("newPassword") ?? "");
  if (next.length < 12 || Buffer.byteLength(next, "utf8") > 72) return { ok: false, message: "Use at least 12 characters and at most 72 bytes." };
  if (next !== form.get("confirmPassword")) return { ok: false, message: "The new passwords do not match." };
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user?.passwordHash || !await bcrypt.compare(current, user.passwordHash)) return { ok: false, message: "Current password is incorrect." };
  await prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  return { ok: true, message: "Password updated." };
}
