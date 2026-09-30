import { failure } from "@/lib/http";
import { handleRazorpayWebhook } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Razorpay → Settings → Webhooks: this URL, event payment_link.paid, secret = RAZORPAY_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  try {
    return Response.json(handleRazorpayWebhook(await req.text(), req.headers.get("x-razorpay-signature")));
  } catch (e) {
    return failure(e);
  }
}
