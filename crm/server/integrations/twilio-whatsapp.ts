import crypto from "node:crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { safeEqual } from "@/lib/crypto";
import type { ChannelAdapter, NormalizedEvent, SimulatedInput } from "./types";

/**
 * WhatsApp via Twilio (Programmable Messaging — WhatsApp).
 * Docs: https://www.twilio.com/docs/whatsapp/api
 *
 * One webhook URL (/api/webhooks/whatsapp) receives both:
 *   - inbound messages   ("A message comes in" on the sender / sandbox), and
 *   - delivery statuses  (StatusCallback we attach to every outbound send).
 * Both are application/x-www-form-urlencoded and signed with X-Twilio-Signature.
 */

const API = "https://api.twilio.com/2010-04-01";

type TwilioParams = Record<string, string>;

/**
 * Twilio request validation: base64(HMAC-SHA1(authToken, url + concat(sorted key+value)))
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function computeTwilioSignature(authToken: string, url: string, params: TwilioParams): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: TwilioParams,
  signature: string | null,
): boolean {
  if (!authToken || !signature) return false;
  try {
    return safeEqual(signature, computeTwilioSignature(authToken, url, params));
  } catch {
    return false;
  }
}

function parseForm(rawBody: string): TwilioParams {
  return Object.fromEntries(new URLSearchParams(rawBody));
}

/** "whatsapp:+919812345678" → "+919812345678" */
function waNumber(address: string | undefined): string {
  const digits = (address ?? "").replace(/^whatsapp:/, "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

function webhookUrl(): string {
  return env.twilio.webhookUrl || `${env.appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`;
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED" | undefined> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  undelivered: "FAILED",
};

export const twilioWhatsappAdapter: ChannelAdapter = {
  channel: "WHATSAPP",
  label: "WhatsApp (Twilio)",
  supportsOutbound: true,

  parsePayload(rawBody, contentType) {
    // Twilio always posts form-encoded; accept JSON too for the in-app Simulator.
    if (contentType?.includes("application/json")) return JSON.parse(rawBody);
    return parseForm(rawBody);
  },

  ackResponse() {
    // Empty TwiML: acknowledge without an automatic reply (replies are sent via the API).
    return { body: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", contentType: "text/xml" };
  },

  verifySignature(rawBody, headers, requestUrl) {
    const signature = headers.get("x-twilio-signature");
    const params = parseForm(rawBody);
    // Twilio signs the exact URL configured in its console. Try the configured URL first,
    // then the URL rebuilt from APP_URL (they match unless TWILIO_WEBHOOK_URL differs).
    const candidates = [...new Set([webhookUrl(), requestUrl].filter(Boolean) as string[])];
    const ok =
      candidates.some((url) => verifyTwilioSignature(env.twilio.authToken, url, params, signature)) ||
      (env.demoMode && headers.get("x-simulated-signature") === "demo");
    return { ok, organizationId: undefined, reason: ok ? undefined : "Invalid X-Twilio-Signature" };
  },

  normalize(payload) {
    const p = (payload ?? {}) as TwilioParams;
    const sid = p.MessageSid || p.SmsMessageSid || p.SmsSid;
    if (!sid) return [];

    const status = (p.MessageStatus || p.SmsStatus || "").toLowerCase();
    const numMedia = Number(p.NumMedia || 0);
    const isInbound = status === "received" || (!p.MessageStatus && (p.Body !== undefined || numMedia > 0));

    if (isInbound) {
      const phone = waNumber(p.From);
      const attachments = Array.from({ length: numMedia }, (_, i) => ({
        name: `media-${i + 1}`,
        url: p[`MediaUrl${i}`],
        mime: p[`MediaContentType${i}`],
      })).filter((a) => a.url);
      const firstMime = attachments[0]?.mime ?? "";
      const type: NonNullable<NormalizedEvent["message"]>["type"] = firstMime.startsWith("image/")
        ? "IMAGE"
        : firstMime.startsWith("audio/")
          ? "AUDIO"
          : firstMime.startsWith("video/")
            ? "VIDEO"
            : attachments.length
              ? "FILE"
              : "TEXT";
      return [
        {
          kind: "message",
          channel: "WHATSAPP",
          providerEventId: `tw:msg:${sid}`,
          identity: { externalId: phone, displayName: p.ProfileName || null, phone },
          threadId: `twilio:${phone.replace(/^\+/, "")}`,
          message: {
            providerMessageId: sid,
            text: p.Body || null,
            type,
            timestamp: new Date(),
            attachments: attachments.length ? attachments : undefined,
          },
        },
      ];
    }

    const state = STATUS_MAP[status];
    if (!state) return []; // queued / accepted / sending: nothing to record yet
    return [
      {
        kind: "status",
        channel: "WHATSAPP",
        providerEventId: `tw:status:${sid}:${status}`,
        identity: { externalId: waNumber(p.To) },
        status: {
          providerMessageId: sid,
          state,
          timestamp: new Date(),
          error: p.ErrorCode ? `Twilio error ${p.ErrorCode}${p.ErrorMessage ? `: ${p.ErrorMessage}` : ""}` : null,
        },
      },
    ];
  },

  buildSimulatedPayload(input: SimulatedInput) {
    const phone = (input.phone ?? "+919812345678").replace(/[^\d]/g, "");
    const sid = `SMSIM${Date.now()}`;
    return {
      providerEventId: `tw:msg:${sid}`,
      payload: {
        MessageSid: sid,
        SmsMessageSid: sid,
        AccountSid: env.twilio.accountSid || "ACSIMULATED",
        From: `whatsapp:+${phone}`,
        To: env.twilio.whatsappFrom || "whatsapp:+14155238886",
        Body: input.message ?? `Hi, I'm interested in ${input.service ?? "a 2 BHK flat"}. Can you share details?`,
        ProfileName: input.name ?? "Simulated Prospect",
        WaId: phone,
        NumMedia: "0",
        SmsStatus: "received",
      },
    };
  },

  async checkSendWindow(conversation) {
    // Same WhatsApp rule regardless of provider: free-form replies only within 24h of the
    // customer's last message; outside it a pre-approved template is required.
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!lastInbound) {
      return {
        ok: false,
        reason: "No inbound message yet — WhatsApp requires an approved template to start the conversation.",
      };
    }
    const ageMs = Date.now() - new Date(lastInbound.providerTimestamp ?? lastInbound.createdAt).getTime();
    if (ageMs > 24 * 3600 * 1000) {
      return {
        ok: false,
        reason: "The 24-hour customer service window has closed. Send an approved template message to re-engage.",
      };
    }
    return { ok: true };
  },

  async sendText(conversation, text) {
    if (env.demoMode) {
      return { accepted: true, providerMessageId: `demo-tw-${Date.now()}` };
    }
    const to = (conversation.externalThreadId ?? "").split(":").pop();
    return sendTwilioWhatsApp(to ? `+${to.replace(/^\+/, "")}` : "", text);
  },
};

/** Send a WhatsApp message through Twilio. Used by the inbox and the AI auto-reply. */
export async function sendTwilioWhatsApp(
  toE164: string,
  body: string,
  opts: { mediaUrl?: string } = {},
): Promise<{ accepted: boolean; providerMessageId?: string | null; error?: string | null }> {
  const { accountSid, authToken, whatsappFrom, messagingServiceSid } = env.twilio;
  if (!env.twilio.configured) {
    return {
      accepted: false,
      error: "Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM).",
    };
  }
  const digits = toE164.replace(/[^\d]/g, "");
  if (digits.length < 8) return { accepted: false, error: "Invalid recipient number." };

  const form = new URLSearchParams({ To: `whatsapp:+${digits}`, Body: body, StatusCallback: webhookUrl() });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : `whatsapp:${whatsappFrom}`);
  if (opts.mediaUrl) form.set("MediaUrl", opts.mediaUrl);

  try {
    const res = await fetch(`${API}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { accepted: false, error: json?.message ? `Twilio ${json.code ?? res.status}: ${json.message}` : `HTTP ${res.status}` };
    }
    return { accepted: true, providerMessageId: json?.sid ?? null };
  } catch (e) {
    return { accepted: false, error: e instanceof Error ? e.message : String(e) };
  }
}
