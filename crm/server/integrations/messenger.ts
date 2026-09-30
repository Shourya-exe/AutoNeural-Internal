import { env } from "@/lib/env";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";
import { metaVerifyChallenge, verifyMetaSignature } from "./signature";

/**
 * Facebook Messenger (Page messaging) adapter.
 * Docs: https://developers.facebook.com/docs/messenger-platform/webhooks
 *
 * Senders are identified only by a Page-Scoped ID (PSID). We NEVER invent an
 * email or phone number for a Messenger user.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export const messengerAdapter: ChannelAdapter = {
  channel: "MESSENGER",
  label: "Facebook Messenger",
  supportsOutbound: true,

  verifyChallenge(query) {
    return metaVerifyChallenge(query, env.messenger.verifyToken);
  },

  verifySignature(rawBody, headers) {
    const ok =
      verifyMetaSignature(rawBody, headers, env.messenger.appSecret) ||
      (env.demoMode && headers.get("x-simulated-signature") === "demo");
    return { ok, reason: ok ? undefined : "Invalid X-Hub-Signature-256" };
  },

  normalize(payload) {
    const events: NormalizedEvent[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const ev of entry?.messaging ?? []) {
        const psid: string = ev.sender?.id;
        if (ev.message && !ev.message.is_echo) {
          events.push({
            kind: "message",
            channel: "MESSENGER",
            providerEventId: `fb:msg:${ev.message.mid}`,
            identity: {
              externalId: psid,
              displayName: ev.sender?.name ?? null, // usually absent
            },
            threadId: `${entry.id}:${psid}`,
            message: {
              providerMessageId: ev.message.mid,
              text: ev.message.text ?? null,
              type: ev.message.attachments?.length ? "FILE" : "TEXT",
              timestamp: ev.timestamp ? new Date(Number(ev.timestamp)) : new Date(),
              attachments: (ev.message.attachments ?? []).map((a: any) => ({
                name: a.type,
                url: a.payload?.url ?? "",
                mime: a.type,
              })),
            },
          });
        }
        if (ev.delivery) {
          for (const mid of ev.delivery.mids ?? []) {
            events.push({
              kind: "status",
              channel: "MESSENGER",
              providerEventId: `fb:delivery:${mid}`,
              identity: { externalId: psid },
              status: { providerMessageId: mid, state: "DELIVERED", timestamp: new Date() },
            });
          }
        }
        if (ev.read) {
          events.push({
            kind: "status",
            channel: "MESSENGER",
            providerEventId: `fb:read:${psid}:${ev.read.watermark}`,
            identity: { externalId: psid },
            status: { providerMessageId: `watermark:${ev.read.watermark}`, state: "READ" },
          });
        }
      }
    }
    return events;
  },

  buildSimulatedPayload(input: SimulatedInput) {
    const psid = `SIMPSID${Math.floor(Math.random() * 1e8)}`;
    const mid = `m_SIM${Date.now()}`;
    return {
      providerEventId: `fb:msg:${mid}`,
      payload: {
        object: "page",
        entry: [
          {
            id: env.messenger.pageId || "SIM_PAGE",
            time: Date.now(),
            messaging: [
              {
                sender: { id: psid },
                recipient: { id: env.messenger.pageId || "SIM_PAGE" },
                timestamp: Date.now(),
                message: {
                  mid,
                  text:
                    input.message ??
                    `Hello! Do you build ${input.service ?? "custom software"}? Saw your page.`,
                },
              },
            ],
          },
        ],
      },
    };
  },

  async checkSendWindow() {
    // Messenger standard messaging is allowed within 24h of the last user
    // message; message tags are required outside it. We enforce the same 24h
    // rule as WhatsApp via the generic last-inbound check in conversations.ts,
    // so a simple pass here is sufficient for connected pages.
    return { ok: true };
  },

  async sendText(conversation, text) {
    if (env.demoMode) return { accepted: true, providerMessageId: `demo-fb-${Date.now()}` };
    if (!env.messenger.pageAccessToken) {
      return { accepted: false, error: "Messenger Page access token not configured." };
    }
    const psid = (conversation.externalThreadId ?? "").split(":").pop();
    const res = await fetch(
      `${GRAPH}/me/messages?access_token=${encodeURIComponent(env.messenger.pageAccessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          messaging_type: "RESPONSE",
          message: { text },
        }),
      },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { accepted: false, error: json?.error?.message ?? `HTTP ${res.status}` };
    return { accepted: true, providerMessageId: json?.message_id ?? null };
  },
};
