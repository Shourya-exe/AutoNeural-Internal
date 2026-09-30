import { prisma } from "@/lib/prisma";
import { toE164 } from "@/lib/phone";
import type { Channel, Prisma, IdentityMatchConfidence } from "@prisma/client";

export interface InboundIdentity {
  channel: Channel;
  /** Provider-scoped stable id (wa E.164, PSID, IG-scoped id, email, form email…). */
  externalId: string;
  displayName?: string | null;
  /** Optional extra signals the provider supplied. */
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ResolvedIdentity {
  contactId: string;
  channelIdentityId: string;
  /** True when a brand-new contact was created for this identity. */
  createdContact: boolean;
  /** True when the link to an existing contact is not certain and needs review. */
  needsReview: boolean;
}

/**
 * Find-or-create a Contact + ChannelIdentity for an inbound identity.
 *
 * Matching rules (conservative by design):
 *  1. Exact match on (org, channel, externalId) -> reuse. This is the ONLY
 *     path that silently attaches to an existing contact.
 *  2. If a strong secondary signal is present (valid E.164 phone OR email) and
 *     matches exactly one existing contact -> attach identity, flagged
 *     needsReview=false for phone/email exactness but recorded as a TOUCHPOINT.
 *  3. Otherwise -> create a NEW contact. Never merge on name alone.
 *
 * Contacts are never auto-merged here; uncertain links are surfaced for a human
 * in Settings → Duplicates / the lead's "Review match" action.
 */
export async function resolveIdentity(
  organizationId: string,
  input: InboundIdentity,
  tx: Prisma.TransactionClient = prisma,
): Promise<ResolvedIdentity> {
  const channel = input.channel;
  const externalId = input.externalId.trim();

  // 1. Exact identity hit.
  const existing = await tx.channelIdentity.findUnique({
    where: {
      organizationId_channel_externalId: { organizationId, channel, externalId },
    },
  });
  if (existing) {
    return {
      contactId: existing.contactId,
      channelIdentityId: existing.id,
      createdContact: false,
      needsReview: existing.needsReview,
    };
  }

  // 2. Strong secondary signal match.
  const e164 = toE164(input.phone ?? (channel === "WHATSAPP" ? externalId : null));
  const email = normaliseEmail(input.email);

  let matchedContactId: string | null = null;
  let confidence: IdentityMatchConfidence = "STRONG";
  let needsReview = false;

  if (e164) {
    const byPhone = await tx.contact.findMany({
      where: { organizationId, primaryPhone: e164, mergedIntoId: null },
      select: { id: true },
      take: 2,
    });
    if (byPhone.length === 1) matchedContactId = byPhone[0].id;
    else if (byPhone.length > 1) needsReview = true;
  }

  if (!matchedContactId && email) {
    const byEmail = await tx.contact.findMany({
      where: { organizationId, primaryEmail: email, mergedIntoId: null },
      select: { id: true },
      take: 2,
    });
    if (byEmail.length === 1) matchedContactId = byEmail[0].id;
    else if (byEmail.length > 1) needsReview = true;
  }

  if (matchedContactId) {
    const ci = await tx.channelIdentity.create({
      data: {
        organizationId,
        contactId: matchedContactId,
        channel,
        externalId,
        displayName: input.displayName ?? null,
        confidence,
        needsReview,
        metadata: (input.metadata as any) ?? undefined,
      },
    });
    // Backfill contact contact-info if missing (do not overwrite).
    await backfillContact(tx, matchedContactId, { email, phone: e164, name: input.displayName });
    return {
      contactId: matchedContactId,
      channelIdentityId: ci.id,
      createdContact: false,
      needsReview,
    };
  }

  // 3. Create a fresh contact.
  const contact = await tx.contact.create({
    data: {
      organizationId,
      fullName: input.displayName?.trim() || fallbackName(channel, externalId),
      primaryEmail: email,
      primaryPhone: e164,
    },
  });
  const ci = await tx.channelIdentity.create({
    data: {
      organizationId,
      contactId: contact.id,
      channel,
      externalId,
      displayName: input.displayName ?? null,
      confidence: "STRONG",
      needsReview: false,
      metadata: (input.metadata as any) ?? undefined,
    },
  });
  return {
    contactId: contact.id,
    channelIdentityId: ci.id,
    createdContact: true,
    needsReview: false,
  };
}

async function backfillContact(
  tx: Prisma.TransactionClient,
  contactId: string,
  data: { email?: string | null; phone?: string | null; name?: string | null },
) {
  const c = await tx.contact.findUnique({ where: { id: contactId } });
  if (!c) return;
  const patch: Prisma.ContactUpdateInput = {};
  if (!c.primaryEmail && data.email) patch.primaryEmail = data.email;
  if (!c.primaryPhone && data.phone) patch.primaryPhone = data.phone;
  if ((!c.fullName || c.fullName.startsWith("Unknown ")) && data.name) patch.fullName = data.name;
  if (Object.keys(patch).length) await tx.contact.update({ where: { id: contactId }, data: patch });
}

function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

function fallbackName(channel: Channel, externalId: string): string {
  const tail = externalId.length > 6 ? externalId.slice(-6) : externalId;
  const label: Record<string, string> = {
    WHATSAPP: "WhatsApp",
    MESSENGER: "Messenger",
    INSTAGRAM: "Instagram",
    META_LEAD_ADS: "Lead Ad",
    WEBSITE_FORM: "Website",
    PHONE: "Caller",
  };
  return `Unknown ${label[channel] ?? channel} ${tail}`;
}
