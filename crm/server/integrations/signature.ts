import { hmacSha256Hex, safeEqual } from "@/lib/crypto";

/**
 * Meta (WhatsApp / Messenger / Instagram / Lead Ads) sign the raw request body
 * with the App Secret and send it as `X-Hub-Signature-256: sha256=<hex>`.
 */
export function verifyMetaSignature(rawBody: string, headers: Headers, appSecret: string): boolean {
  if (!appSecret) return false;
  const header = headers.get("x-hub-signature-256") ?? headers.get("X-Hub-Signature-256");
  if (!header) return false;
  const [, provided] = header.split("=");
  if (!provided) return false;
  const expected = hmacSha256Hex(appSecret, rawBody);
  try {
    return safeEqual(provided, expected);
  } catch {
    return false;
  }
}

/**
 * Website forms: our public site signs the raw JSON body with a shared secret
 * and sends `x-form-signature: <hex>`.
 */
export function verifyFormSignature(rawBody: string, headers: Headers, secret: string): boolean {
  if (!secret) return true; // signing optional; endpoint still rate-limited + honeypot
  const provided = headers.get("x-form-signature");
  if (!provided) return false;
  const expected = hmacSha256Hex(secret, rawBody);
  try {
    return safeEqual(provided, expected);
  } catch {
    return false;
  }
}

/** GET verification handshake shared by all Meta webhooks. */
export function metaVerifyChallenge(query: URLSearchParams, verifyToken: string): string | null {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");
  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    return challenge ?? "";
  }
  return null;
}
