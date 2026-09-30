import { makeWebhookHandlers } from "../../handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keep the legacy callback URL compatible, but use signature verification,
// deduplication and normal inbox ingestion. The old handler sent AI messages
// from unsigned requests and did not persist inbound conversations.
export const { GET, POST } = makeWebhookHandlers("WHATSAPP");
