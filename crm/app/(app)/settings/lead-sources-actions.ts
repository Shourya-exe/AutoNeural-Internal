"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { requireActor, requireCan } from "@/server/auth/context";
import { writeAudit } from "@/server/services/audit";
import {
  newIntakeKey,
  pullIndiaMart,
  pullSheetFeeds,
  toCsvUrl,
  type SheetFeed,
  type SheetFeedStatus,
} from "@/server/services/lead-sources";

type Result = { ok: true; detail?: string; key?: string } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });

async function admin() {
  const actor = await requireActor();
  requireCan(actor, "settings.integrations");
  return actor;
}

const connection = (organizationId: string, channel: Channel) =>
  prisma.integrationConnection.findUnique({ where: { organizationId_channel: { organizationId, channel } } });

const summary = (r: { created: number; duplicates: number; error?: string; skipped?: string }) =>
  r.skipped === "throttled"
    ? "Checked recently — the next automatic check will pick up new rows."
    : r.error
      ? r.error
      : `${r.created} new lead${r.created === 1 ? "" : "s"} loaded${r.duplicates ? `, ${r.duplicates} already in the CRM` : ""}.`;

// ─── Sheet / CSV feeds ───────────────────────────────────────────────────────

export async function addSheetFeedAction(input: { label: string; url: string }): Promise<Result> {
  try {
    const actor = await admin();
    const label = z.string().trim().min(1).max(60).parse(input.label);
    const url = toCsvUrl(input.url);
    const conn = await connection(actor.organizationId, "SHEET_FEED");
    const feeds = decryptJson<{ feeds: SheetFeed[] }>(conn?.encryptedConfig)?.feeds ?? [];
    if (feeds.length >= 20) throw new Error("Up to 20 feeds are supported.");
    if (feeds.some((f) => f.url === url)) throw new Error("This sheet is already connected.");
    const feed: SheetFeed = { id: randomBytes(6).toString("hex"), label, url };
    const pub = (conn?.publicConfig ?? {}) as { feeds?: SheetFeedStatus[] };
    const saved = await prisma.integrationConnection.upsert({
      where: { organizationId_channel: { organizationId: actor.organizationId, channel: "SHEET_FEED" } },
      update: {
        status: "CONNECTED",
        encryptedConfig: encryptJson({ feeds: [...feeds, feed] }),
        publicConfig: { ...pub, feeds: [...(pub.feeds ?? []), { id: feed.id, label, host: new URL(url).host }] } as any,
      },
      create: {
        organizationId: actor.organizationId,
        channel: "SHEET_FEED",
        label: "Sheet / CSV feeds",
        status: "CONNECTED",
        encryptedConfig: encryptJson({ feeds: [feed] }),
        publicConfig: { feeds: [{ id: feed.id, label, host: new URL(url).host }] } as any,
      },
    });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead_source.sheet.add",
      entityType: "IntegrationConnection",
      entityId: "SHEET_FEED",
      after: { label, host: new URL(url).host },
    });
    // Load existing rows straight away so the team sees the result immediately.
    const r = await pullSheetFeeds(saved, { force: true });
    revalidatePath("/settings/integrations");
    revalidatePath("/leads");
    return r.error ? { ok: false, error: r.error } : { ok: true, detail: summary(r) };
  } catch (e) {
    return fail(e);
  }
}

export async function removeSheetFeedAction(feedId: string): Promise<Result> {
  try {
    const actor = await admin();
    const conn = await connection(actor.organizationId, "SHEET_FEED");
    if (!conn) return { ok: true };
    const feeds = (decryptJson<{ feeds: SheetFeed[] }>(conn.encryptedConfig)?.feeds ?? []).filter((f) => f.id !== feedId);
    const pub = (conn.publicConfig ?? {}) as { feeds?: SheetFeedStatus[] };
    await prisma.integrationConnection.update({
      where: { id: conn.id },
      data: {
        status: feeds.length ? "CONNECTED" : "NOT_CONFIGURED",
        encryptedConfig: encryptJson({ feeds }),
        publicConfig: { ...pub, feeds: (pub.feeds ?? []).filter((f) => f.id !== feedId) } as any,
      },
    });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead_source.sheet.remove",
      entityType: "IntegrationConnection",
      entityId: "SHEET_FEED",
      after: { feedId },
    });
    revalidatePath("/settings/integrations");
    return { ok: true, detail: "Feed removed. Leads already loaded stay in the CRM." };
  } catch (e) {
    return fail(e);
  }
}

// ─── IndiaMART ───────────────────────────────────────────────────────────────

export async function connectIndiaMartAction(apiKey: string): Promise<Result> {
  try {
    const actor = await admin();
    const key = z.string().trim().min(10).max(200).parse(apiKey);
    const saved = await prisma.integrationConnection.upsert({
      where: { organizationId_channel: { organizationId: actor.organizationId, channel: "INDIAMART" } },
      // A new key restarts the cursor so the last 7 days are backfilled.
      update: { status: "CONNECTED", encryptedConfig: encryptJson({ apiKey: key }), publicConfig: {}, lastErrorText: null },
      create: {
        organizationId: actor.organizationId,
        channel: "INDIAMART",
        label: "IndiaMART Lead Manager",
        status: "CONNECTED",
        encryptedConfig: encryptJson({ apiKey: key }),
        publicConfig: {},
      },
    });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead_source.indiamart.connect",
      entityType: "IntegrationConnection",
      entityId: "INDIAMART",
    });
    const r = await pullIndiaMart(saved, { force: true });
    revalidatePath("/settings/integrations");
    revalidatePath("/leads");
    return r.error ? { ok: false, error: r.error } : { ok: true, detail: `Connected. ${summary(r)}` };
  } catch (e) {
    return fail(e);
  }
}

// ─── Shared ──────────────────────────────────────────────────────────────────

export async function pullNowAction(channel: "SHEET_FEED" | "INDIAMART"): Promise<Result> {
  try {
    const actor = await admin();
    const conn = await connection(actor.organizationId, channel);
    if (!conn || conn.status !== "CONNECTED") throw new Error("This source is not connected.");
    const r = channel === "SHEET_FEED" ? await pullSheetFeeds(conn, { force: true }) : await pullIndiaMart(conn, { force: true });
    revalidatePath("/settings/integrations");
    revalidatePath("/leads");
    return r.error ? { ok: false, error: r.error } : { ok: true, detail: summary(r) };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectLeadSourceAction(channel: "SHEET_FEED" | "INDIAMART" | "LEAD_API"): Promise<Result> {
  try {
    const actor = await admin();
    await prisma.integrationConnection.updateMany({
      where: { organizationId: actor.organizationId, channel },
      data: { status: "NOT_CONFIGURED", encryptedConfig: null, publicConfig: {} },
    });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead_source.disconnect",
      entityType: "IntegrationConnection",
      entityId: channel,
    });
    revalidatePath("/settings/integrations");
    return { ok: true, detail: "Disconnected. Leads already loaded stay in the CRM." };
  } catch (e) {
    return fail(e);
  }
}

/** Creates (or rotates) the intake API key. The key is returned once and only its hash is stored. */
export async function generateIntakeKeyAction(): Promise<Result> {
  try {
    const actor = await admin();
    const { key, keyHash, keyPrefix } = newIntakeKey();
    await prisma.integrationConnection.upsert({
      where: { organizationId_channel: { organizationId: actor.organizationId, channel: "LEAD_API" } },
      update: { status: "CONNECTED", publicConfig: { keyHash, keyPrefix, createdAt: new Date().toISOString() } },
      create: {
        organizationId: actor.organizationId,
        channel: "LEAD_API",
        label: "Lead intake API",
        status: "CONNECTED",
        publicConfig: { keyHash, keyPrefix, createdAt: new Date().toISOString() },
      },
    });
    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead_source.api_key.rotate",
      entityType: "IntegrationConnection",
      entityId: "LEAD_API",
      after: { keyPrefix },
    });
    revalidatePath("/settings/integrations");
    return { ok: true, key, detail: "Copy this key now — it will not be shown again. Any previous key stops working." };
  } catch (e) {
    return fail(e);
  }
}
