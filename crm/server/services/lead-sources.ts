import { createHash, randomBytes } from "node:crypto";
import Papa from "papaparse";
import type { Channel, IntegrationConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptJson, safeEqual } from "@/lib/crypto";
import { enqueueWebhookProcessing } from "@/server/queue/queues";
import {
  INDIAMART_MAX_WINDOW_MS,
  INDIAMART_MIN_INTERVAL_MS,
  INDIAMART_URL,
  indiamartRecordToPayload,
  indiamartTime,
  mapRowToLead,
  type LeadSourcePayload,
} from "@/server/integrations/lead-sources";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const SHEET_MIN_INTERVAL_MS = 2 * 60_000;
export const SHEET_MAX_ROWS = 5000;
const SHEET_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export interface SheetFeed {
  id: string;
  label: string;
  url: string; // secret: anyone holding a share link can read the sheet
}
export interface SheetFeedStatus {
  id: string;
  label: string;
  host: string;
  lastPulledAt?: string;
  lastCount?: number;
  lastError?: string | null;
}
export interface PullResult {
  skipped?: "throttled" | "not-connected";
  created: number;
  duplicates: number;
  error?: string;
}

/**
 * Persist lead payloads as WebhookEvents and hand them to the normal ingestion
 * pipeline. Already-seen provider ids are skipped in one query, so re-reading a
 * whole sheet every few minutes costs one SELECT, not thousands of failed INSERTs.
 */
export async function recordLeadEvents(
  organizationId: string,
  channel: Channel,
  payloads: LeadSourcePayload[],
): Promise<{ created: number; duplicates: number }> {
  if (!payloads.length) return { created: 0, duplicates: 0 };
  const seen = new Set(
    (
      await prisma.webhookEvent.findMany({
        where: { organizationId, channel, providerEventId: { in: payloads.map((p) => p._id) } },
        select: { providerEventId: true },
      })
    ).map((e) => e.providerEventId),
  );
  let created = 0;
  for (const p of payloads) {
    if (seen.has(p._id)) continue;
    seen.add(p._id);
    try {
      const event = await prisma.webhookEvent.create({
        data: { organizationId, channel, providerEventId: p._id, signatureValid: true, status: "RECEIVED", payload: p as any },
      });
      created++;
      await enqueueWebhookProcessing(event.id);
    } catch (e: any) {
      if (e?.code !== "P2002") throw e; // concurrent sweep already stored it
    }
  }
  if (created) {
    await prisma.integrationConnection.updateMany({
      where: { organizationId, channel },
      data: { lastEventAt: new Date() },
    });
  }
  return { created, duplicates: payloads.length - created };
}

// ─── Sheet / CSV feeds ───────────────────────────────────────────────────────

/**
 * Accepts a Google Sheets link (edit, share or published) or any HTTPS CSV URL,
 * and returns the CSV download URL. Rejects non-HTTPS and private/loopback hosts
 * because the server fetches this address.
 */
export function toCsvUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid link.");
  }
  if (url.protocol !== "https:") throw new Error("Only https:// links are supported.");
  // ponytail: literal-host check only; add DNS-resolution checks if untrusted users can add feeds.
  const h = url.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) ||
    h.startsWith("[")
  ) {
    throw new Error("That address is not reachable from the CRM.");
  }
  const m = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (h === "docs.google.com" && m && m[1] !== "e") {
    const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
  }
  if (h === "docs.google.com" && url.pathname.includes("/pub")) {
    url.searchParams.set("output", "csv");
  }
  return url.toString();
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403 || res.status === 404
        ? `The sheet is not accessible (HTTP ${res.status}). Share it as "Anyone with the link can view" or publish it as CSV.`
        : `Fetching the sheet failed (HTTP ${res.status}).`,
    );
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    throw new Error("The link returned a web page, not CSV. Share the sheet as \"Anyone with the link can view\".");
  }
  const text = await res.text();
  if (text.length > SHEET_MAX_BYTES) throw new Error("The sheet is larger than 5 MB.");
  return text;
}

/** Parse CSV text into lead payloads with content-derived ids (stable across re-reads). */
export function csvToLeadPayloads(csv: string, feed: Pick<SheetFeed, "url" | "label">): {
  payloads: LeadSourcePayload[];
  skippedRows: number;
} {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: "greedy" });
  const rows = parsed.data.slice(0, SHEET_MAX_ROWS);
  const feedKey = sha256(feed.url).slice(0, 12);
  const payloads: LeadSourcePayload[] = [];
  let skippedRows = 0;
  for (const row of rows) {
    const lead = mapRowToLead(row);
    if (!lead) {
      skippedRows++;
      continue;
    }
    // Hash only the mapped lead fields, so editing unrelated columns (status,
    // notes the team adds in the sheet) does not re-import the row.
    payloads.push({
      ...lead,
      _id: `sheet:${feedKey}:${sha256(JSON.stringify(lead)).slice(0, 24)}`,
      sourceDetail: `Sheet: ${feed.label}`,
    });
  }
  return { payloads, skippedRows };
}

export async function pullSheetFeeds(
  conn: IntegrationConnection,
  opts: { now?: Date; force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<PullResult> {
  const now = opts.now ?? new Date();
  const pub = (conn.publicConfig ?? {}) as { lastAttemptAt?: string; feeds?: SheetFeedStatus[] };
  if (conn.status !== "CONNECTED") return { skipped: "not-connected", created: 0, duplicates: 0 };
  if (!opts.force && pub.lastAttemptAt && now.getTime() - Date.parse(pub.lastAttemptAt) < SHEET_MIN_INTERVAL_MS) {
    return { skipped: "throttled", created: 0, duplicates: 0 };
  }
  const feeds = decryptJson<{ feeds: SheetFeed[] }>(conn.encryptedConfig)?.feeds ?? [];
  const statuses = new Map((pub.feeds ?? []).map((f) => [f.id, f]));
  let created = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const feed of feeds) {
    const status: SheetFeedStatus = statuses.get(feed.id) ?? { id: feed.id, label: feed.label, host: new URL(feed.url).host };
    try {
      const { payloads } = csvToLeadPayloads(await fetchText(feed.url, opts.fetchImpl ?? fetch), feed);
      const r = await recordLeadEvents(conn.organizationId, "SHEET_FEED", payloads);
      created += r.created;
      duplicates += r.duplicates;
      Object.assign(status, { lastPulledAt: now.toISOString(), lastCount: r.created, lastError: null });
    } catch (e) {
      status.lastError = (e as Error).message;
      errors.push(`${feed.label}: ${status.lastError}`);
    }
    statuses.set(feed.id, status);
  }

  await prisma.integrationConnection.update({
    where: { id: conn.id },
    data: {
      publicConfig: { ...pub, lastAttemptAt: now.toISOString(), feeds: [...statuses.values()] } as any,
      ...(errors.length
        ? { lastErrorAt: now, lastErrorText: errors.join(" · ").slice(0, 1000) }
        : { lastErrorText: null }),
    },
  });
  return { created, duplicates, error: errors[0] };
}

// ─── IndiaMART ───────────────────────────────────────────────────────────────

export async function pullIndiaMart(
  conn: IntegrationConnection,
  opts: { now?: Date; force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<PullResult> {
  const now = opts.now ?? new Date();
  const pub = (conn.publicConfig ?? {}) as { lastAttemptAt?: string; lastPulledAt?: string; lastCount?: number };
  if (conn.status !== "CONNECTED") return { skipped: "not-connected", created: 0, duplicates: 0 };
  // IndiaMART blocks keys that call more than once per 5 minutes; "force" still
  // respects that hard floor so a "Pull now" click can never get the key blocked.
  const sinceAttempt = pub.lastAttemptAt ? now.getTime() - Date.parse(pub.lastAttemptAt) : Infinity;
  if (sinceAttempt < (opts.force ? 5 * 60_000 : INDIAMART_MIN_INTERVAL_MS)) {
    return { skipped: "throttled", created: 0, duplicates: 0 };
  }
  const apiKey = decryptJson<{ apiKey: string }>(conn.encryptedConfig)?.apiKey;
  if (!apiKey) return { skipped: "not-connected", created: 0, duplicates: 0 };

  // Resume from the last successful end time with a 5-minute overlap (ids dedupe);
  // first run backfills the maximum 7-day window.
  const floor = now.getTime() - INDIAMART_MAX_WINDOW_MS + 60_000;
  const start = new Date(Math.max(pub.lastPulledAt ? Date.parse(pub.lastPulledAt) - 5 * 60_000 : floor, floor));
  const url = new URL(INDIAMART_URL);
  url.searchParams.set("glusr_crm_key", apiKey);
  url.searchParams.set("start_time", indiamartTime(start));
  url.searchParams.set("end_time", indiamartTime(now));

  const base = { ...pub, lastAttemptAt: now.toISOString() };
  let result: PullResult;
  let error: string | null = null;
  let status: IntegrationConnection["status"] = conn.status;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as {
      CODE?: number;
      STATUS?: string;
      MESSAGE?: string;
      RESPONSE?: Record<string, unknown>[];
    };
    const code = Number(body.CODE ?? res.status);
    if (code === 200 || code === 204) {
      const payloads = (Array.isArray(body.RESPONSE) ? body.RESPONSE : [])
        .map(indiamartRecordToPayload)
        .filter((p): p is LeadSourcePayload => p !== null);
      const r = await recordLeadEvents(conn.organizationId, "INDIAMART", payloads);
      Object.assign(base, { lastPulledAt: now.toISOString(), lastCount: r.created });
      result = r;
    } else {
      error =
        code === 401
          ? "IndiaMART rejected the API key (expired or invalid). Generate a new key in Lead Manager → CRM Integration."
          : code === 429
            ? "IndiaMART rate limit reached; the CRM will retry after the cool-down."
            : `IndiaMART returned ${code}: ${body.MESSAGE ?? "unknown error"}`;
      if (code === 401) status = "ERROR";
      result = { created: 0, duplicates: 0, error };
    }
  } catch (e) {
    error = `Could not reach IndiaMART: ${(e as Error).message}`;
    result = { created: 0, duplicates: 0, error };
  }
  await prisma.integrationConnection.update({
    where: { id: conn.id },
    data: {
      status,
      publicConfig: base as any,
      ...(error ? { lastErrorAt: now, lastErrorText: error } : { lastErrorText: null }),
    },
  });
  return result;
}

/** Called by the periodic sweep for every organization. Each source self-throttles. */
export async function pullLeadSources(organizationId: string, now = new Date()): Promise<string[]> {
  const conns = await prisma.integrationConnection.findMany({
    where: { organizationId, channel: { in: ["SHEET_FEED", "INDIAMART"] }, status: "CONNECTED" },
  });
  const errors: string[] = [];
  for (const c of conns) {
    const r = c.channel === "SHEET_FEED" ? await pullSheetFeeds(c, { now }) : await pullIndiaMart(c, { now });
    if (r.error) errors.push(`${c.channel}: ${r.error}`);
  }
  return errors;
}

// ─── Lead intake API key ─────────────────────────────────────────────────────

export function newIntakeKey() {
  const key = `anl_${randomBytes(24).toString("base64url")}`;
  return { key, keyHash: sha256(key), keyPrefix: key.slice(0, 8) };
}

/** Resolve the organization for a presented intake key (hash comparison, constant-time). */
export async function organizationForIntakeKey(key: string): Promise<string | null> {
  if (!/^anl_[A-Za-z0-9_-]{32}$/.test(key)) return null;
  const hash = sha256(key);
  const conns = await prisma.integrationConnection.findMany({
    where: { channel: "LEAD_API", status: "CONNECTED" },
    select: { organizationId: true, publicConfig: true },
  });
  const match = conns.find((c) => {
    const stored = (c.publicConfig as { keyHash?: string } | null)?.keyHash;
    return !!stored && safeEqual(stored, hash);
  });
  return match?.organizationId ?? null;
}
