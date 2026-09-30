import {
  addManualLead,
  addSheetFeed,
  connectIndiaMart,
  disconnectIndiaMart,
  leadSourceSettings,
  listLeads,
  pullLeadSources,
  removeSheetFeed,
  revokeIntakeKey,
  rotateIntakeKey,
  setLeadOwners,
  updateLead,
} from "@/lib/leads";
import { connectFacebookPage, facebookStatus, retryFacebookLeads } from "@/lib/facebook";
import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { requireAdmin } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    // Opening the Leads page also nudges the pulled sources (they throttle themselves).
    void pullLeadSources().catch((e) => console.error("[leads] pull failed", e));
    return Response.json(
      { leads: listLeads(user), sources: user.role === "admin" ? { ...leadSourceSettings(user), facebook: facebookStatus() } : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; [k: string]: unknown };
    switch (b.action) {
      case "status":
        return Response.json(updateLead(user, b));
      case "add":
        return Response.json(addManualLead(user, b.lead));
      case "rotateKey":
        return Response.json({ key: rotateIntakeKey(user) });
      case "revokeKey":
        revokeIntakeKey(user);
        return Response.json({ ok: true });
      case "addSheet":
        return Response.json(await addSheetFeed(user, b));
      case "removeSheet":
        removeSheetFeed(user, String(b.id));
        return Response.json({ ok: true });
      case "connectIndiaMart":
        return Response.json(await connectIndiaMart(user, b.apiKey));
      case "disconnectIndiaMart":
        disconnectIndiaMart(user);
        return Response.json({ ok: true });
      case "owners":
        setLeadOwners(user, b.ids);
        return Response.json({ ok: true });
      case "pull": {
        requireAdmin(user);
        const [r, facebook] = await Promise.all([pullLeadSources({ force: true }), retryFacebookLeads({ force: true })]);
        return Response.json({ ...r, facebook });
      }
      case "connectFacebook":
        return Response.json(await connectFacebookPage(user));
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}
