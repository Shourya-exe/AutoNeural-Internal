import { handleWebhook, verifySignature, verifySubscription } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta → WhatsApp → Configuration → Webhook: this URL, verify token = WHATSAPP_VERIFY_TOKEN, field "messages". */
export function GET(req: Request) {
  const challenge = verifySubscription(new URL(req.url).searchParams);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let touched: string[] = [];
  try {
    touched = handleWebhook(JSON.parse(raw));
  } catch (e) {
    console.error("[whatsapp] webhook failed", e);
    return new Response("Error", { status: 500 }); // Meta retries; inbound messages are de-duplicated by id
  }
  // Reply after acknowledging Meta quickly.
  for (const id of touched) {
    void import("@/lib/wa-agent").then((m) => m.agentReply(id)).catch((e) => console.error("[whatsapp] AI agent failed", e));
  }
  return new Response("OK");
}
