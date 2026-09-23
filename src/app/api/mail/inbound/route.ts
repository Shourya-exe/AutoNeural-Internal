import { recordInboundEmail, allUsers } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.json();

    // Standardize incoming webhook fields from Resend Inbound / SendGrid / custom forwarder
    const fromEmail =
      raw.fromEmail ||
      raw.from?.email ||
      (typeof raw.from === "string" ? raw.from.match(/<([^>]+)>/)?.[1] || raw.from : "") ||
      "";
    const fromName =
      raw.fromName ||
      raw.from?.name ||
      (typeof raw.from === "string" ? raw.from.replace(/<[^>]+>/, "").trim() : "") ||
      fromEmail.split("@")[0];

    const toEmail =
      raw.toEmail ||
      (Array.isArray(raw.to) ? raw.to[0]?.email || raw.to[0] : raw.to) ||
      raw.recipient ||
      "";

    const subject = raw.subject || "(No Subject)";
    const body = raw.text || raw.body || raw.content || "";

    if (!fromEmail || !toEmail) {
      return Response.json(
        { error: "Both from and to email addresses are required." },
        { status: 400 },
      );
    }

    const saved = recordInboundEmail({
      fromEmail,
      fromName,
      toEmail,
      subject,
      body,
      taskId: raw.taskId,
    });

    return Response.json({ ok: true, id: saved.id }, { status: 201 });
  } catch (err: any) {
    console.error("[InboundWebhook Error]", err);
    return Response.json({ error: err?.message || "Invalid webhook payload" }, { status: 400 });
  }
}
