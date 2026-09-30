import { cookies } from 'next/headers';
import { backend, clearSession } from '@/lib/session';
import { forbiddenOrigin, sameOrigin } from '@/lib/origin';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const refreshToken = (await cookies()).get('an_rt')?.value;
  if (refreshToken) {
    await backend('/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
  }
  await clearSession();
  return Response.json({ ok: true });
}
