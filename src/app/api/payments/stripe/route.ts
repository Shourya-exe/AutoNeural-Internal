import { failure } from "@/lib/http";
import { handleStripeWebhook } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe → Developers → Webhooks: this URL, event checkout.session.completed, secret = STRIPE_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  try {
    return Response.json(handleStripeWebhook(await req.text(), req.headers.get("stripe-signature")));
  } catch (e) {
    return failure(e);
  }
}
