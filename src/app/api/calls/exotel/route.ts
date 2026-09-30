import { failure } from "@/lib/http";
import { exotelCallback } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const type = req.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await req.json() : Object.fromEntries(await req.formData());
    return Response.json(exotelCallback(String(q.get("id")), String(q.get("t")), data as Record<string, unknown>));
  } catch (e) {
    return failure(e);
  }
}
