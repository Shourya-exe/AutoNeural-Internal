import crypto from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM encryption for integration tokens stored in the database.
 * Key comes from INTEGRATION_ENCRYPTION_KEY (base64, 32 bytes).
 */

function key() {
  const raw = env.integrationEncryptionKey;
  const buf = Buffer.from(raw, "base64");
  // Derive a stable 32-byte key when the provided value isn't exactly 32 bytes.
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptJson<T = unknown>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  try {
    const [ivB64, tagB64, dataB64] = blob.split(".");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Constant-time HMAC-SHA256 hex, used for webhook signature verification. */
export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Redact obvious secrets from an object before it is written to logs / audit. */
export function redact<T>(obj: T): T {
  const SECRET_KEYS = /token|secret|password|authorization|api[-_]?key|signature|cookie/i;
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SECRET_KEYS.test(k) ? "[redacted]" : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(obj);
}
