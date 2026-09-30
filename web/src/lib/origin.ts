/** Same-origin gate for state-changing calls (session cookies are SameSite=Lax; this closes the rest). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return !!origin && !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const forbiddenOrigin = () => Response.json({ message: 'Request origin is not allowed.' }, { status: 403 });
