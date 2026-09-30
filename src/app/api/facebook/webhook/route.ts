import { importLeads, queueLeadgen, verifyFacebookSignature, verifyFacebookSubscription } from "@/lib/facebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta app → Webhooks → Page: this URL, verify token = FACEBOOK_VERIFY_TOKEN (else WHATSAPP_VERIFY_TOKEN), field "leadgen". */
export function GET(req: Request) {
  const challenge = verifyFacebookSubscription(new URL(req.url).searchParams);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyFacebookSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let ids: string[] = [];
  try {
    ids = queueLeadgen(JSON.parse(raw));
  } catch (e) {
    console.error("[facebook] webhook failed", e);
    return new Response("Error", { status: 500 }); // Meta retries; leads are de-duplicated by leadgen id
  }
  // Read the answers after acknowledging Meta; anything that fails stays queued for the minute loop.
  if (ids.length) void importLeads(ids).catch((e) => console.error("[facebook] import failed", e));
  return new Response("OK");
}
