import { cookies } from "next/headers";
import { z } from "zod";
import { login, logout, changePassword } from "@/lib/store";
import {
  body,
  cookieName,
  cookieOptions,
  failure,
  requireUser,
  sameOrigin,
} from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const p = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(200),
      })
      .parse(await body(req));
    const result = login(p.email, p.password);
    (await cookies()).set(cookieName, result.token, cookieOptions(req));
    return Response.json({ user: result.user });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser(true);
    const p = z
      .object({
        current: z.string().min(1).max(200),
        password: z.string().min(12, "Use at least 12 characters.").max(200),
      })
      .parse(await body(req));
    changePassword(user, p.current, p.password);
    const result = login(user.email, p.password);
    (await cookies()).set(cookieName, result.token, cookieOptions(req));
    return Response.json({ user: result.user });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const jar = await cookies();
    const token = jar.get(cookieName)?.value;
    if (token) logout(token);
    jar.set(cookieName, "", { ...cookieOptions(req), maxAge: 0 });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
