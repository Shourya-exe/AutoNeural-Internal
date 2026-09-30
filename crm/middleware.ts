import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const DEMO_MODE = ["1", "true", "yes", "on"].includes(
  (process.env.DEMO_MODE ?? "false").toLowerCase(),
);
// Sign-in is required unless explicitly disabled (AUTH_REQUIRED=false) for a demo preview.
const AUTH_REQUIRED = !["0", "false", "no", "off"].includes(
  (process.env.AUTH_REQUIRED ?? "true").toLowerCase(),
);

// ─────────────────────────── HTTP Basic Auth gate ───────────────────────────
// A site-wide password wall for the deployed subdomain (e.g. crm.autoneural.in),
// sitting IN FRONT of the app's own sign-in. Enabled only when BASIC_AUTH_USER
// and BASIC_AUTH_PASSWORD are both set, so local development is unaffected.
const BASIC_USER = process.env.BASIC_AUTH_USER ?? "";
const BASIC_PASS = process.env.BASIC_AUTH_PASSWORD ?? "";
const BASIC_ENABLED = BASIC_USER !== "" && BASIC_PASS !== "";
const BASIC_REALM = process.env.BASIC_AUTH_REALM ?? "AutoNeural CRM";

/**
 * Paths that must stay reachable WITHOUT the Basic-Auth password, because a
 * browser prompt would break them:
 *   - provider webhooks (Meta cannot send Basic credentials; these are already
 *     protected by X-Hub-Signature-256 verification)
 *   - the public website-form endpoint (posted by autoneural.in visitors; it is
 *     rate-limited, honeypot-protected and optionally HMAC-signed)
 *   - the example enquiry page
 *   - the health endpoint, for uptime monitoring
 *   - the scheduler sweep endpoint (a cron job cannot answer a password
 *     prompt; it authenticates with CRON_SECRET instead)
 *   - the voice agent's call-ingestion endpoint (authenticates with
 *     AGENT_INGEST_SECRET)
 */
const BASIC_AUTH_BYPASS = [
  "/api/webhooks",
  "/api/public",
  "/api/health",
  "/api/cron",
  "/api/agent/calls",
  "/api/agent/whatsapp",
  "/enquiry",
];

/** Length-safe, timing-resistant string comparison (no node:crypto on edge). */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkBasicAuth(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Evaluate both comparisons so the response time does not reveal which failed.
  const userOk = safeCompare(user, BASIC_USER);
  const passOk = safeCompare(pass, BASIC_PASS);
  return userOk && passOk;
}

function basicAuthChallenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${BASIC_REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}

// ─────────────────────────── App session gate ───────────────────────────
// Public app paths that never require an application session.
const PUBLIC = [
  "/login",
  "/enquiry",
  "/api/auth",
  "/api/public",
  "/api/webhooks",
  "/api/health",
  "/api/cron",
  "/api/agent/calls",
  "/api/agent/whatsapp",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/media/") || // public/media: login-page background video etc.
    pathname === "/robots.txt";

  const host = req.headers.get("host") ?? "";
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");

  // 1. Site-wide password wall (deployment only, bypassed on localhost).
  if (BASIC_ENABLED && !isAsset && !isLocal) {
    const bypass = BASIC_AUTH_BYPASS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (!bypass && !checkBasicAuth(req as unknown as NextRequest)) {
      return basicAuthChallenge();
    }
  }

  // 2. Application session.
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
  if (isAsset) return;

  // Demo preview without sign-in: the app auto-resolves to the demo Admin, so no redirect.
  if (DEMO_MODE && !AUTH_REQUIRED) return;

  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
