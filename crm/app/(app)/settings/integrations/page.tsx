import { requireActor, can } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { relativeTime, fmtDateTime } from "@/lib/datetime";
import { listAdapters, PLANNED_CHANNELS } from "@/server/integrations/registry";
import { LEAD_SOURCE_CHANNELS } from "@/server/integrations/lead-sources";
import { SETUP_GUIDE, webhookPath } from "@/server/integrations/setup-guide";
import { IntegrationCard, type IntegrationCardData } from "@/components/settings/integration-card";
import { WebhookEventsTable } from "@/components/settings/webhook-events";
import { LeadSources, type LeadSourcesData } from "@/components/settings/lead-sources";
import type { SheetFeedStatus } from "@/server/services/lead-sources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Channel } from "@prisma/client";

export const dynamic = "force-dynamic";

const CRED_MAP: Record<string, { secret: string; verify: string; token: string }> = {
  WHATSAPP:
    env.whatsappProvider === "twilio"
      ? {
          // Twilio: auth token signs webhooks; no verify handshake; SID + sender send messages.
          secret: env.twilio.authToken,
          verify: "n/a",
          token: env.twilio.configured ? "set" : "",
        }
      : {
          secret: env.whatsapp.appSecret,
          verify: env.whatsapp.verifyToken,
          token: env.whatsapp.accessToken && env.whatsapp.phoneNumberId ? "set" : "",
        },
  META_LEAD_ADS: {
    secret: env.metaLeadAds.appSecret,
    verify: env.metaLeadAds.verifyToken,
    token: env.metaLeadAds.pageAccessToken,
  },
  MESSENGER: {
    secret: env.messenger.appSecret,
    verify: env.messenger.verifyToken,
    token: env.messenger.pageAccessToken,
  },
  INSTAGRAM: {
    secret: env.instagram.appSecret,
    verify: env.instagram.verifyToken,
    token: env.instagram.accessToken,
  },
  WEBSITE_FORM: {
    secret: env.websiteForm.signingSecret,
    verify: env.websiteForm.signingSecret,
    token: "n/a",
  },
};

export default async function IntegrationsPage() {
  const actor = await requireActor();
  if (!can(actor, "settings.integrations")) {
    return (
      <Card>
        <CardContent className="p-6 text-xs text-espresso-500">
          Only Admins can manage integrations.
        </CardContent>
      </Card>
    );
  }

  const [connections, events] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { organizationId: actor.organizationId } }),
    prisma.webhookEvent.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { receivedAt: "desc" },
      take: 25,
    }),
  ]);

  const byChannel = new Map(connections.map((c) => [c.channel, c]));

  const cards: IntegrationCardData[] = listAdapters()
    .filter((a) => !LEAD_SOURCE_CHANNELS.includes(a.channel))
    .map((a) => {
    const conn = byChannel.get(a.channel);
    const creds = CRED_MAP[a.channel] ?? { secret: "", verify: "", token: "" };
    const guide =
      a.channel === "WHATSAPP" && env.whatsappProvider === "twilio" ? SETUP_GUIDE.WHATSAPP_TWILIO : SETUP_GUIDE[a.channel];
    return {
      channel: a.channel,
      label: conn?.label ?? "Not connected",
      status: (conn?.status ?? "NOT_CONFIGURED") as IntegrationCardData["status"],
      webhookUrl: `${env.appUrl}${webhookPath(a.channel)}`,
      appSecretSet: !!creds.secret,
      verifyTokenSet: creds.verify === "n/a" ? true : !!creds.verify,
      accessTokenSet: creds.token === "n/a" ? true : !!creds.token,
      lastEventAt: conn?.lastEventAt ? relativeTime(conn.lastEventAt) : null,
      lastErrorAt: conn?.lastErrorAt ? relativeTime(conn.lastErrorAt) : null,
      lastErrorText: conn?.lastErrorText ?? null,
      publicConfig: (conn?.publicConfig as Record<string, string>) ?? {},
      supportsOutbound: a.supportsOutbound,
      setupSteps: guide?.steps ?? [],
      requiredEnv: guide?.env ?? [],
    };
  });

  const rel = (iso?: string | null) => (iso ? relativeTime(new Date(iso)) : null);
  const sheetConn = byChannel.get("SHEET_FEED");
  const imConn = byChannel.get("INDIAMART");
  const apiConn = byChannel.get("LEAD_API");
  const sheetPub = (sheetConn?.publicConfig ?? {}) as { feeds?: SheetFeedStatus[] };
  const imPub = (imConn?.publicConfig ?? {}) as { lastPulledAt?: string; lastCount?: number };
  const apiPub = (apiConn?.publicConfig ?? {}) as { keyPrefix?: string; createdAt?: string };
  const leadSources: LeadSourcesData = {
    sheets: {
      connected: sheetConn?.status === "CONNECTED",
      feeds: (sheetPub.feeds ?? []).map((f) => ({
        id: f.id,
        label: f.label,
        host: f.host,
        lastPulledAt: rel(f.lastPulledAt),
        lastCount: f.lastCount ?? null,
        lastError: f.lastError ?? null,
      })),
    },
    indiamart: {
      connected: imConn?.status === "CONNECTED",
      lastPulledAt: rel(imPub.lastPulledAt),
      lastCount: imPub.lastCount ?? null,
      lastError: imConn?.lastErrorText ?? null,
    },
    api: {
      connected: apiConn?.status === "CONNECTED",
      keyPrefix: apiPub.keyPrefix ?? null,
      createdAt: rel(apiPub.createdAt),
      lastEventAt: apiConn?.lastEventAt ? relativeTime(apiConn.lastEventAt) : null,
      endpoint: `${env.appUrl}/api/public/leads`,
    },
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Automatic lead sources</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Leads from these sources are added to the CRM automatically, deduplicated by phone and email, assigned
            and run through your automations — no manual entry.
          </p>
        </CardHeader>
        <CardContent>
          <LeadSources data={leadSources} />
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Autoneural company contact</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <a className="underline" href={env.whatsappUrl}>WhatsApp: +91 62979 27642</a>
          <p className="text-muted-foreground">Register this number with your WhatsApp Business API provider and configure its phone number ID and webhook credentials to send and receive messages in the CRM. A WhatsApp registration on your phone alone does not connect the API.</p>
        </CardContent>
      </Card>
      {env.demoMode && (
        <div className="rounded-lg border border-gold/30 bg-gold/10 p-4 text-xs text-gold-700">
          <p className="font-semibold">Demo mode is on.</p>
          <p className="mt-1 leading-relaxed">
            The connection states below come from <strong>synthetic seed data</strong>. No real
            Meta / WhatsApp account is connected, and no outbound message leaves this system. A
            successful simulated event proves the ingestion pipeline works — it does{" "}
            <strong>not</strong> prove a live provider connection.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {cards.map((c) => (
          <IntegrationCard key={c.channel} data={c} demoMode={env.demoMode} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planned channels</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            The adapter interface supports these. They are not implemented and are never shown as
            connected.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {PLANNED_CHANNELS.map((p) => (
            <div
              key={p.channel}
              className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2"
            >
              <div>
                <p className="text-xs text-espresso-700">{p.label}</p>
                <p className="text-[10px] text-muted-foreground">{p.note}</p>
              </div>
              <Badge variant="outline">Planned</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent webhook events &amp; failure queue</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Every provider delivery is persisted before processing. Failures retry with backoff;
            dead-lettered events can be replayed by an Admin.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <WebhookEventsTable
            events={events.map((e) => ({
              id: e.id,
              channel: e.channel,
              providerEventId: e.providerEventId,
              status: e.status,
              attempts: e.attempts,
              signatureValid: e.signatureValid,
              isSimulated: e.isSimulated,
              error: e.error,
              receivedAt: fmtDateTime(e.receivedAt),
              nextRetryAt: e.nextRetryAt ? fmtDateTime(e.nextRetryAt) : null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
