import { API_URL, setSession } from '@/lib/session';
import { forbiddenOrigin, sameOrigin } from '@/lib/origin';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== 'string' || typeof password !== 'string') {
    return Response.json({ message: 'Enter your email and password.' }, { status: 400 });
  }
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return Response.json({ message: 'The server is unreachable. Try again shortly.' }, { status: 502 });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ message: body.message ?? 'Sign-in failed.' }, { status: res.status });
  await setSession(body);
  return Response.json({ user: body.user });
}
