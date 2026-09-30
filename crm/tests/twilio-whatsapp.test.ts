import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  twilioWhatsappAdapter,
  computeTwilioSignature,
  verifyTwilioSignature,
} from "@/server/integrations/twilio-whatsapp";

const TOKEN = "test-twilio-auth-token";
const URL_ = "https://demo.autoneural.in/api/webhooks/whatsapp";

/** Independent implementation of Twilio's documented algorithm, to cross-check ours. */
function referenceSignature(token: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", token).update(data).digest("base64");
}

const INBOUND = {
  SmsMessageSid: "SM11111111111111111111111111111111",
  MessageSid: "SM11111111111111111111111111111111",
  AccountSid: "ACxxxxxxxx",
  From: "whatsapp:+919812345678",
  To: "whatsapp:+14155238886",
  Body: "Hi, looking for a 2 BHK in Salt Lake",
  ProfileName: "Arpan",
  WaId: "919812345678",
  NumMedia: "0",
  SmsStatus: "received",
};
const encode = (p: Record<string, string>) => new URLSearchParams(p).toString();

describe("Twilio WhatsApp signature", () => {
  it("matches Twilio's documented algorithm", () => {
    expect(computeTwilioSignature(TOKEN, URL_, INBOUND)).toBe(referenceSignature(TOKEN, URL_, INBOUND));
  });

  it("accepts a correctly signed webhook", async () => {
    const raw = encode(INBOUND);
    const headers = new Headers({ "x-twilio-signature": referenceSignature(TOKEN, URL_, INBOUND) });
    const res = await twilioWhatsappAdapter.verifySignature(raw, headers, URL_);
    expect(res.ok).toBe(true);
  });

  it("rejects a signature made with the wrong auth token", async () => {
    const raw = encode(INBOUND);
    const headers = new Headers({ "x-twilio-signature": referenceSignature("attacker", URL_, INBOUND) });
    expect((await twilioWhatsappAdapter.verifySignature(raw, headers, URL_)).ok).toBe(false);
  });

  it("rejects a body tampered with after signing", async () => {
    const sig = referenceSignature(TOKEN, URL_, INBOUND);
    const raw = encode({ ...INBOUND, Body: "send me money" });
    const res = await twilioWhatsappAdapter.verifySignature(raw, new Headers({ "x-twilio-signature": sig }), URL_);
    expect(res.ok).toBe(false);
  });

  it("rejects a signature for a different URL", () => {
    const sig = referenceSignature(TOKEN, "https://evil.example/hook", INBOUND);
    expect(verifyTwilioSignature(TOKEN, URL_, INBOUND, sig)).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    expect((await twilioWhatsappAdapter.verifySignature(encode(INBOUND), new Headers(), URL_)).ok).toBe(false);
  });
});

describe("Twilio WhatsApp normalization", () => {
  it("parses a form-encoded inbound message", () => {
    const payload = twilioWhatsappAdapter.parsePayload!(encode(INBOUND), "application/x-www-form-urlencoded");
    const [ev] = twilioWhatsappAdapter.normalize(payload);
    expect(ev.kind).toBe("message");
    expect(ev.providerEventId).toBe("tw:msg:SM11111111111111111111111111111111");
    expect(ev.identity).toMatchObject({ externalId: "+919812345678", phone: "+919812345678", displayName: "Arpan" });
    expect(ev.threadId).toBe("twilio:919812345678");
    expect(ev.message).toMatchObject({ text: "Hi, looking for a 2 BHK in Salt Lake", type: "TEXT" });
  });

  it("keeps media attachments on inbound messages", () => {
    const [ev] = twilioWhatsappAdapter.normalize({
      ...INBOUND,
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/2010-04-01/Accounts/AC/Messages/SM/Media/ME1",
      MediaContentType0: "image/jpeg",
    });
    expect(ev.message?.type).toBe("IMAGE");
    expect(ev.message?.attachments?.[0]).toMatchObject({ mime: "image/jpeg" });
  });

  it("maps delivery status callbacks and ignores in-flight states", () => {
    const base = { MessageSid: "SM22222222222222222222222222222222", To: "whatsapp:+919812345678", From: "whatsapp:+14155238886" };
    const [delivered] = twilioWhatsappAdapter.normalize({ ...base, MessageStatus: "delivered", SmsStatus: "delivered" });
    expect(delivered).toMatchObject({ kind: "status", status: { state: "DELIVERED" } });

    const [failed] = twilioWhatsappAdapter.normalize({ ...base, MessageStatus: "undelivered", ErrorCode: "63016" });
    expect(failed.status).toMatchObject({ state: "FAILED", error: "Twilio error 63016" });

    expect(twilioWhatsappAdapter.normalize({ ...base, MessageStatus: "queued" })).toEqual([]);
  });

  it("produces a simulator payload that normalizes to an inbound message", () => {
    const { payload, providerEventId } = twilioWhatsappAdapter.buildSimulatedPayload({ phone: "+919800000001", name: "Sim" });
    const [ev] = twilioWhatsappAdapter.normalize(payload);
    expect(ev.providerEventId).toBe(providerEventId);
    expect(ev.identity.phone).toBe("+919800000001");
  });
});
