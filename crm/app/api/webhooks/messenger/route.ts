import { makeWebhookHandlers } from "../handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const { GET, POST } = makeWebhookHandlers("MESSENGER");
