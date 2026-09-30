import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { whatsappAdapter } from "@/server/integrations/whatsapp";
import { metaLeadAdsAdapter } from "@/server/integrations/meta-lead-ads";
import { messengerAdapter } from "@/server/integrations/messenger";
import { instagramAdapter } from "@/server/integrations/instagram";
import { verifyMetaSignature, metaVerifyChallenge } from "@/server/integrations/signature";

function sign(secret: string, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

describe("webhook signature verification", () => {
  it("accepts a correctly signed WhatsApp payload", async () => {
    const headers = new Headers({
      "x-hub-signature-256": sign("test-whatsapp-secret", BODY),
    });
    const res = await whatsappAdapter.verifySignature(BODY, headers);
    expect(res.ok).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const headers = new Headers({ "x-hub-signature-256": sign("attacker-secret", BODY) });
    const res = await whatsappAdapter.verifySignature(BODY, headers);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature/i);
  });

  it("rejects a payload whose body was tampered with after signing", async () => {
    const headers = new Headers({ "x-hub-signature-256": sign("test-whatsapp-secret", BODY) });
    const tampered = BODY.replace("entry", "entrY");
    const res = await whatsappAdapter.verifySignature(tampered, headers);
    expect(res.ok).toBe(false);
  });

  it("rejects a payload with no signature header at all", async () => {
    const res = await whatsappAdapter.verifySignature(BODY, new Headers());
    expect(res.ok).toBe(false);
  });

  it("rejects a malformed signature header", async () => {
    const res = await whatsappAdapter.verifySignature(
      BODY,
      new Headers({ "x-hub-signature-256": "not-a-signature" }),
    );
    expect(res.ok).toBe(false);
  });

  it("verifies each Meta adapter against its own app secret only", async () => {
    const cases = [
      { adapter: metaLeadAdsAdapter, secret: "test-leadads-secret" },
      { adapter: messengerAdapter, secret: "test-messenger-secret" },
      { adapter: instagramAdapter, secret: "test-instagram-secret" },
    ];
    for (const c of cases) {
      const good = new Headers({ "x-hub-signature-256": sign(c.secret, BODY) });
      const bad = new Headers({ "x-hub-signature-256": sign("test-whatsapp-secret", BODY) });
      expect((await c.adapter.verifySignature(BODY, good)).ok).toBe(true);
      expect((await c.adapter.verifySignature(BODY, bad)).ok).toBe(false);
    }
  });

  it("never validates when the configured secret is empty", () => {
    expect(verifyMetaSignature(BODY, new Headers({ "x-hub-signature-256": sign("", BODY) }), "")).toBe(
      false,
    );
  });
});

describe("webhook subscription handshake", () => {
  it("returns the challenge when mode and verify token match", () => {
    const q = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "secret-token",
      "hub.challenge": "1234567890",
    });
    expect(metaVerifyChallenge(q, "secret-token")).toBe("1234567890");
  });

  it("returns null for a wrong verify token", () => {
    const q = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "1234567890",
    });
    expect(metaVerifyChallenge(q, "secret-token")).toBeNull();
  });

  it("returns null when the mode is not subscribe", () => {
    const q = new URLSearchParams({
      "hub.mode": "unsubscribe",
      "hub.verify_token": "secret-token",
      "hub.challenge": "x",
    });
    expect(metaVerifyChallenge(q, "secret-token")).toBeNull();
  });
});
