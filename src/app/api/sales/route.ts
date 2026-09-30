import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { allUsers } from "@/lib/store";
import {
  addManualPayment,
  company,
  convertToInvoice,
  createDocument,
  createPaymentLinks,
  createTicket,
  emailDocument,
  gateways,
  launchCampaign,
  listCampaigns,
  listDocuments,
  listTickets,
  meetingsFor,
  paymentsFor,
  previewAudience,
  saveCompany,
  salesSummary,
  scheduleMeeting,
  setDocumentStatus,
  updateDeal,
  updateTicket,
  whatsappConfigured,
} from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appUrl = (req: Request) => (process.env.CRM_APP_URL || new URL(req.url).origin).replace(/\/$/, "");

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    const view = q.get("view");
    const admin = user.role === "admin";
    const data =
      view === "documents"
        ? { documents: listDocuments(user).map((d) => ({ ...d, payments: paymentsFor(d.id) })), company: company(), gateways: gateways() }
        : view === "campaigns"
          ? { campaigns: admin ? listCampaigns(user) : [], whatsapp: whatsappConfigured() }
          : view === "tickets"
            ? { tickets: listTickets(user), team: allUsers().map((u) => ({ id: u.id, name: u.name })) }
            : view === "meetings"
              ? { meetings: meetingsFor(user, String(q.get("leadId"))) }
              : { summary: salesSummary(user), company: admin ? company() : null };
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; id?: string; [k: string]: unknown };
    const id = String(b.id ?? "");
    switch (b.action) {
      case "deal":
        return Response.json(updateDeal(user, b));
      case "company":
        saveCompany(user, b.company);
        return Response.json({ ok: true });
      case "createDocument":
        return Response.json(createDocument(user, b.document));
      case "documentStatus":
        return Response.json(setDocumentStatus(user, b));
      case "convert":
        return Response.json(convertToInvoice(user, id));
      case "payment":
        return Response.json(addManualPayment(user, b));
      case "paymentLinks":
        return Response.json(await createPaymentLinks(user, id, appUrl(req)));
      case "emailDocument":
        return Response.json(await emailDocument(user, id, appUrl(req)));
      case "meeting":
        return Response.json(await scheduleMeeting(user, b));
      case "audience":
        return Response.json(previewAudience(user, b));
      case "campaign":
        return Response.json(launchCampaign(user, b.campaign, appUrl(req)));
      case "ticket":
        return Response.json(createTicket(user, b.ticket));
      case "ticketUpdate":
        return Response.json(updateTicket(user, b));
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}
