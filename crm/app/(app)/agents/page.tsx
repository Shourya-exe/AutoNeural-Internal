import { requireActor } from "@/server/auth/context";
import { env } from "@/lib/env";
import { listAgentSessions, getCallLogStats } from "@/server/services/call-logs";
import { fmtDateTime } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { AgentControl } from "@/components/agents/agent-control";
import { CallDialer } from "@/components/agents/call-dialer";
import { getAgentStatus } from "@/lib/voice-agent";
import { Bot, Phone, Clock, PhoneMissed, PhoneCall, Mic } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const actor = await requireActor();
  const [sessions, stats, agentStatus] = await Promise.all([
    listAgentSessions(actor.organizationId, 15),
    getCallLogStats(actor.organizationId),
    getAgentStatus(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-espresso">
          <Bot className="size-5 text-gold-700" /> AI Voice Agent
        </h1>
        <p className="text-xs text-muted-foreground">
          LiveKit-powered inbound & outbound calling with Deepgram speech and your configured LLM.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company phone &amp; missed-call answering</CardTitle>
          <CardDescription>Jio: +91 62979 27642 · WhatsApp: +91 62979 27642</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Badge variant="gold">Jio forwarding &amp; live test pending</Badge>
          <p>Your company phone rings first. Once Jio forwards an unanswered call to an inbound-enabled Vobiz number, the Autoneural AI assistant can answer and capture the caller’s requirements in this CRM.</p>
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>The LiveKit inbound route for Vobiz +91 80653 54081 is configured for Autoneural. Confirm that Vobiz delivers inbound calls to it.</li>
            <li>In MyJio or your phone’s call settings, configure “forward when unanswered” to +91 80653 54081 after verifying it receives calls.</li>
            <li>Keep the voice worker running and test one answered call and one unanswered call before relying on the service.</li>
          </ol>
          <p className="text-xs text-muted-foreground">The outgoing Vobiz number alone does not confirm inbound support. This route handles regular phone calls; WhatsApp voice calls are separate.</p>
          <a href={env.whatsappUrl} className="inline-block text-gold-700 underline">Message Autoneural on WhatsApp</a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Conversation &amp; WhatsApp follow-up</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>The assistant confirms unclear names and numbers, remembers corrections during the call, and can send a requested WhatsApp summary after confirming the recipient.</p>
          <Badge variant={(env.whatsappProvider === "twilio" ? env.twilio.configured : !!env.whatsapp.phoneNumberId && !!env.whatsapp.accessToken) ? "gold" : "muted"}>
            {(env.whatsappProvider === "twilio" ? env.twilio.configured : !!env.whatsapp.phoneNumberId && !!env.whatsapp.accessToken) ? "WhatsApp credentials set — verify live delivery" : "WhatsApp API connection required"}
          </Badge>
          <p className="text-xs text-muted-foreground">Phone calls do not open WhatsApp’s 24-hour messaging window. A first follow-up requires an approved template, or the customer must message +91 62979 27642 first. Requests and provider results appear in Inbox.</p>
        </CardContent>
      </Card>

      <Card className="border-gold/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="size-4 text-gold-700" /> Get a call from the AI agent
          </CardTitle>
          <CardDescription>
            Enter a number and the Autoneural AI assistant phones it right away. The call is saved to that
            number&apos;s lead, the Calls page and the Google Sheet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CallDialer agentRunning={agentStatus.running} fromNumber={env.vobiz.outboundNumber} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={PhoneCall} label="Total calls" value={stats.total} />
        <Stat icon={Phone} label="Inbound" value={stats.inbound} />
        <Stat icon={Phone} label="Outbound" value={stats.outbound} />
        <Stat icon={PhoneMissed} label="Missed" value={stats.missed} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent control</CardTitle>
          <CardDescription>Start or stop the voice agent worker process.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentControl
            configured={env.livekit.configured}
            livekitUrl={env.livekit.url}
            llmProvider={env.llm.provider}
            voice={env.deepgram.ttsModel}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent agent sessions</CardTitle>
          <CardDescription>
            Each session is one AI-handled call, linked to a lead where possible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Room</TH>
                <TH>Phone</TH>
                <TH>Lead</TH>
                <TH>Status</TH>
                <TH>Duration</TH>
                <TH>Started</TH>
                <TH>Summary</TH>
              </TR>
            </THead>
            <TBody>
              {sessions.map((s) => (
                <TR key={s.id}>
                  <TD className="font-mono text-xs">{s.roomName}</TD>
                  <TD className="text-xs">{s.phone ?? "—"}</TD>
                  <TD className="text-xs">{s.lead?.contact.fullName ?? "—"}</TD>
                  <TD><Badge variant={s.status === "completed" ? "success" : s.status === "failed" ? "danger" : "default"}>{s.status}</Badge></TD>
                  <TD className="text-xs">{formatDuration(s.duration)}</TD>
                  <TD className="text-xs text-muted-foreground">{s.startTime ? fmtDateTime(s.startTime) : "—"}</TD>
                  <TD className="max-w-[280px] truncate text-xs text-muted-foreground" title={s.summary ?? ""}>
                    {s.summary ?? "—"}
                  </TD>
                </TR>
              ))}
              {sessions.length === 0 && (
                <TR>
                  <TD colSpan={7} className="py-10 text-center text-muted-foreground">
                    <Mic className="mx-auto mb-2 size-6" />
                    No agent sessions yet. Use the dialer above to get a call.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <InfoCard title="Speech-to-Text & TTS" value={env.deepgram.ttsModel} note={env.deepgram.apiKey ? "Deepgram key set" : "Deepgram key missing"} />
        <InfoCard title="Telephony" value={env.vobiz.outboundNumber || "—"} note={env.vobiz.sipDomain ? `SIP: ${env.vobiz.sipDomain}` : "Vobiz not configured"} />
        <InfoCard title="Call logging" value={env.callLogging.sheetId ? "Google Sheets" : "Local only"} note={env.callLogging.sheetId ? "Sheet connected" : "Set GOOGLE_SHEET_ID"} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 pt-4">
        <div className="rounded-md bg-champagne-100 p-2">
          <Icon className="size-4 text-gold-700" />
        </div>
        <div>
          <div className="text-lg font-semibold text-espresso">{value}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm font-medium text-espresso">{value}</div>
        <div className="text-xs text-muted-foreground">{note}</div>
      </CardContent>
    </Card>
  );
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}