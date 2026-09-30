import type { NextRequest } from 'next/server';
import { backend } from '@/lib/session';
import { forbiddenOrigin, sameOrigin } from '@/lib/origin';

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'auth') return Response.json({ message: 'Not found' }, { status: 404 });
  if (req.method !== 'GET' && !sameOrigin(req)) return forbiddenOrigin();
  const res = await backend(`/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
    method: req.method,
    headers: { 'content-type': 'application/json' },
    body: req.method === 'GET' ? undefined : await req.text(),
  }).catch(() => Response.json({ message: 'The server is unreachable. Try again shortly.' }, { status: 502 }));
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
