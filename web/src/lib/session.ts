import 'server-only';
import { cookies } from 'next/headers';

export const API_URL = process.env.API_URL ?? 'http://localhost:3001/api/v1';

export type SessionUser = { id: string; name: string; email: string; role: 'ADMIN' | 'EMPLOYEE' };
type Tokens = { accessToken: string; refreshToken: string; user?: SessionUser };

const base = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
const WEEK = 7 * 86400;

export async function setSession(t: Tokens) {
  const jar = await cookies();
  jar.set('an_at', t.accessToken, { ...base, maxAge: 15 * 60 });
  jar.set('an_rt', t.refreshToken, { ...base, maxAge: WEEK });
  if (t.user) {
    const { id, name, email, role } = t.user;
    jar.set('an_user', JSON.stringify({ id, name, email, role }), { ...base, maxAge: WEEK });
  }
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of ['an_at', 'an_rt', 'an_user']) jar.delete(name);
}

export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  if (!jar.get('an_rt')) return null;
  try {
    return JSON.parse(jar.get('an_user')?.value ?? 'null');
  } catch {
    return null;
  }
}

// Refresh tokens rotate on use, so parallel requests must share one refresh.
// ponytail: in-process map, fine for a single Node server; move to Redis if the web tier scales out.
const refreshing = new Map<string, Promise<Tokens | null>>();

function refresh(rt: string) {
  let p = refreshing.get(rt);
  if (!p) {
    p = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
      cache: 'no-store',
    }).then((r) => (r.ok ? (r.json() as Promise<Tokens>) : null));
    refreshing.set(rt, p);
    // Keep the result briefly for requests that still carry the old cookie.
    setTimeout(() => refreshing.delete(rt), 30_000);
  }
  return p;
}

const unauthorized = () => Response.json({ message: 'Please sign in again.' }, { status: 401 });

/** Calls the backend as the signed-in user, refreshing the access token once if needed. */
export async function backend(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = await cookies();
  const send = (token: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

  const at = jar.get('an_at')?.value;
  const first = at ? await send(at) : null;
  if (first && first.status !== 401) return first;

  const rt = jar.get('an_rt')?.value;
  if (!rt) return unauthorized();
  const tokens = await refresh(rt);
  if (!tokens) {
    await clearSession();
    return unauthorized();
  }
  await setSession(tokens);
  return send(tokens.accessToken);
}
