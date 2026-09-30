import { unsubscribe } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Email preferences</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const params = (req: Request) => {
  const q = new URL(req.url).searchParams;
  return { lead: q.get("l") ?? "", token: q.get("t") ?? "" };
};

/**
 * Link scanners in mail servers open GET links automatically, so GET only asks for
 * confirmation; the unsubscribe itself is a POST (also what one-click List-Unsubscribe sends).
 */
export function GET(req: Request) {
  const { lead, token } = params(req);
  if (!lead || !token) return page("<p>This unsubscribe link is incomplete.</p>", 400);
  const action = `/api/unsubscribe?l=${encodeURIComponent(lead)}&t=${encodeURIComponent(token)}`;
  return page(
    `<h1 style="font-size:1.3rem">Unsubscribe from campaign emails?</h1><p>You will stop receiving marketing emails from us. Messages about work you have asked us to do are not affected.</p><form method="post" action="${action}"><button style="font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;cursor:pointer">Unsubscribe</button></form>`,
  );
}

export function POST(req: Request) {
  const { lead, token } = params(req);
  try {
    unsubscribe(lead, token);
    return page("<p>You have been unsubscribed. You will not receive campaign emails from us again.</p>");
  } catch {
    return page("<p>This unsubscribe link is not valid.</p>", 400);
  }
}
