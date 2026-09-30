import { cookies } from "next/headers";
import { ZodError } from "zod";
import { AppError, userForToken } from "./store";
import { allowedOrigins, configuredAppUrl } from "./config";
export const cookieName = "autoneural_session";
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  return token ? userForToken(token) : null;
}
export async function requireUser(allowPasswordChange = false) {
  const user = await currentUser();
  if (!user) throw new AppError(401, "Please sign in to continue.");
  if (user.mustChange && !allowPasswordChange)
    throw new AppError(403, "Change your temporary password to continue.");
  return user;
}
/**
 * CSRF protection for cookie-authenticated mutations: the browser-supplied Origin must be
 * this app's own origin (CRM_APP_URL, the request's host, or CRM_ALLOWED_ORIGINS).
 * Sibling subdomains are deliberately not trusted: session cookies are SameSite=Lax,
 * which browsers treat as same-site across subdomains.
 */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) {
    throw new AppError(403, "Request origin is not allowed.");
  }

  let supplied: URL;
  try {
    supplied = new URL(origin);
    if (supplied.origin !== origin) {
      throw new Error();
    }
  } catch {
    throw new AppError(403, "Request origin is not allowed.");
  }

  // 1. The configured public origin, or the URL the request arrived on.
  const expected = new URL(configuredAppUrl() || req.url);
  if (origin === expected.origin) return;

  // 2. The host the request was addressed to (behind a reverse proxy: X-Forwarded-Host).
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || expected.protocol.replace(":", "");
  if (host && origin === `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`) return;

  // 3. Explicitly configured extra origins.
  if (allowedOrigins().includes(origin)) return;

  // 4. Localhost / loopback aliases in development.
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    loopback.has(expected.hostname) &&
    loopback.has(supplied.hostname) &&
    supplied.protocol === expected.protocol &&
    supplied.port === expected.port
  ) {
    return;
  }

  throw new AppError(403, "Request origin is not allowed.");
}
/** JSON bodies up to 5 MB (receipts and selfies arrive as data URLs; task files use multipart uploads). */
const MAX_JSON_BYTES = 5 * 1024 * 1024;
export async function body(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new AppError(413, "Request is too large (max 5 MB).");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError(400, "Invalid request.");
  }
}
/** Error → JSON response. Only AppError and validation messages reach the client; anything else is logged. */
export function failure(e: unknown) {
  if (e instanceof AppError || (e as AppError)?.constructor?.name === "AppError") {
    const err = e as AppError;
    if (err.status >= 400 && err.status < 600) return Response.json({ error: err.message }, { status: err.status });
  }
  if (e instanceof ZodError || (e as any)?.name === "ZodError") {
    const issue = (e as ZodError).issues?.[0];
    const field = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return Response.json({ error: issue ? `${field}${issue.message}` : "Check the supplied fields." }, { status: 400 });
  }
  console.error("[request] unhandled error", e);
  return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
}
export function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(configuredAppUrl() || req.url).protocol === "https:",
    path: "/",
    maxAge: 8 * 3600,
  };
}
/**
 * The caller's IP and user agent, for audit logs and rate limits. Behind a reverse proxy the
 * right-most X-Forwarded-For entry is the one the proxy saw; left-most entries are client-supplied.
 */
export function clientContext(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",").at(-1)!.trim() : req.headers.get("x-real-ip")) || "unknown";
  return { ip: ip.slice(0, 64), userAgent: req.headers.get("user-agent")?.slice(0, 500) || undefined };
}
