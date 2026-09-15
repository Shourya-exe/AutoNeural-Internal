import { cookies } from "next/headers";
import { ZodError } from "zod";
import { AppError, userForToken } from "./store";
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

  // 1. Direct match with configured CRM_APP_URL or req.url
  const expected = new URL(process.env.CRM_APP_URL || req.url);
  if (origin === expected.origin) return;

  // 2. Direct match with incoming Host / X-Forwarded-Host
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || expected.protocol.replace(":", "");
  if (host) {
    const hostOrigin = `${proto}://${host}`;
    if (origin === hostOrigin) return;
  }

  // 3. Allow any autoneural.in subdomain under HTTPS
  if (
    supplied.protocol === "https:" &&
    (supplied.hostname === "autoneural.in" || supplied.hostname.endsWith(".autoneural.in"))
  ) {
    return;
  }

  // 4. Localhost / Loopback aliases
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
      if (size > 52428800) {
        await reader.cancel();
        throw new AppError(413, "Request is too large (max 50MB).");
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
export function failure(e: unknown) {
  if (e instanceof AppError)
    return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError)
    return Response.json(
      { error: e.issues[0]?.message || "Check the supplied fields." },
      { status: 400 },
    );
  console.error("CRM request failed", e);
  return Response.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
export function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(process.env.CRM_APP_URL || req.url).protocol === "https:",
    path: "/",
    maxAge: 8 * 3600,
  };
}
