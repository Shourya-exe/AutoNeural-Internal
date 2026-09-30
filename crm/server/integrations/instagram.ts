import { env } from "@/lib/env";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";
import { metaVerifyChallenge, verifyMetaSignature } from "./signature";

/**
 * Instagram messaging adapter (Instagram Graph API for eligible Professional
 * accounts). Docs: https://developers.facebook.com/docs/messenger-platform/instagram
 *
 * Identity is an Instagram-scoped ID (IGSID). We keep IG identities SEPARATE
 * from other channels until a reliable identifier or a manual review links them
 * to an existing contact (identity.ts flags uncertain links).
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export const instagramAdapter: ChannelAdapter = {
  channel: "INSTAGRAM",
  label: "Instagram messaging",
  supportsOutbound: true,

  verifyChallenge(query) {
    return metaVerifyChallenge(query, env.instagram.verifyToken);
  },

  verifySignature(rawBody, headers) {
    const ok =
      verifyMetaSignature(rawBody, headers, env.instagram.appSecret) ||
      (env.demoMode && headers.get("x-simulated-signature") === "demo");
    return { ok, reason: ok ? undefined : "Invalid X-Hub-Signature-256" };
  },

  normalize(payload) {
    const events: NormalizedEvent[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const ev of entry?.messaging ?? []) {
        const igsid: string = ev.sender?.id;
        if (ev.message && !ev.message.is_echo) {
          events.push({
            kind: "message",
            channel: "INSTAGRAM",
            providerEventId: `ig:msg:${ev.message.mid}`,
            identity: {
              externalId: igsid,
              displayName: ev.sender?.username ? `@${ev.sender.username}` : null,
            },
            threadId: `${entry.id}:${igsid}`,
            message: {
              providerMessageId: ev.message.mid,
              text: ev.message.text ?? null,
              type: ev.message.attachments?.length ? "IMAGE" : "TEXT",
              timestamp: ev.timestamp ? new Date(Number(ev.timestamp)) : new Date(),
            },
          });
        }
      }
    }
    return events;
  },

  buildSimulatedPayload(input: SimulatedInput) {
    const igsid = `SIMIGSID${Math.floor(Math.random() * 1e8)}`;
    const mid = `ig_SIM${Date.now()}`;
    return {
      providerEventId: `ig:msg:${mid}`,
      payload: {
        object: "instagram",
        entry: [
          {
            id: env.instagram.accountId || "SIM_IG_ACCOUNT",
            time: Date.now(),
            messaging: [
              {
                sender: { id: igsid, username: "sim_prospect" },
                recipient: { id: env.instagram.accountId || "SIM_IG_ACCOUNT" },
                timestamp: Date.now(),
                message: {
                  mid,
                  text:
                    input.message ??
                    `Hi! Do you set up ${input.service ?? "AI agents"}? DMing from Instagram.`,
                },
              },
            ],
          },
        ],
      },
    };
  },

  async checkSendWindow() {
    return { ok: true };
  },

  async sendText(conversation, text) {
    if (env.demoMode) return { accepted: true, providerMessageId: `demo-ig-${Date.now()}` };
    if (!env.instagram.accessToken) {
      return { accepted: false, error: "Instagram access token not configured." };
    }
    const igsid = (conversation.externalThreadId ?? "").split(":").pop();
    const res = await fetch(
      `${GRAPH}/me/messages?access_token=${encodeURIComponent(env.instagram.accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
      },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { accepted: false, error: json?.error?.message ?? `HTTP ${res.status}` };
    return { accepted: true, providerMessageId: json?.message_id ?? null };
  },
};
