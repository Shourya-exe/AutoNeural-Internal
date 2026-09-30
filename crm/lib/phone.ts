import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalise a phone number to E.164. Returns null when the input cannot be
 * confidently parsed — callers must NOT treat a failed parse as a match.
 * Defaults to India (IN), AutoNeural's primary market.
 *
 * Two stages, deliberately:
 *  1. libphonenumber-js for full validation of any international format.
 *  2. A deterministic digit heuristic as a fallback. libphonenumber's bundled
 *     metadata can fail to load under some CJS/bundler combinations (it throws
 *     from isSupportedCountry), and a silent null here would break identity
 *     matching — the very thing this function exists to make reliable.
 */
export function toE164(raw: string | null | undefined, defaultCountry: "IN" = "IN"): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;

  try {
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (parsed && parsed.isValid()) return parsed.number; // E.164
  } catch {
    // Metadata/runtime problem — fall through to the heuristic below.
  }

  // ── Fallback: metadata-free normalisation ──
  const compact = cleaned.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(compact)) return compact;

  const bare = compact.replace(/^\+/, "").replace(/^00/, "");
  if (defaultCountry === "IN") {
    // Already carries the country code: 91 + a valid 10-digit mobile (6-9 lead).
    if (/^91[6-9]\d{9}$/.test(bare)) return `+${bare}`;
    // National format, with or without a trunk 0.
    const national = bare.replace(/^0/, "");
    if (/^[6-9]\d{9}$/.test(national)) return `+91${national}`;
  }
  return null;
}

export function phoneMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = toE164(a);
  const nb = toE164(b);
  return !!na && !!nb && na === nb;
}
