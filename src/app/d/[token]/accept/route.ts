import { acceptQuote } from "@/lib/sales";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    acceptQuote(token);
  } catch {
    return new Response("Quotation not found.", { status: 404 });
  }
  return Response.redirect(new URL(`/d/${token}?accepted=1`, req.url), 303);
}
