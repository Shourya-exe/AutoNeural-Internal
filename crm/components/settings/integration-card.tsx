"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { simulateEventAction } from "@/app/(app)/settings/actions";
import { channelMeta } from "@/components/domain/badges";
import { Copy, Check, FlaskConical, ChevronDown } from "lucide-react";

export interface IntegrationCardData {
  channel: any;
  label: string;
  status: "NOT_CONFIGURED" | "SETUP_INCOMPLETE" | "CONNECTED" | "PERMISSION_REQUIRED" | "ERROR";
  webhookUrl: string;
  verifyTokenSet: boolean;
  appSecretSet: boolean;
  accessTokenSet: boolean;
  lastEventAt: string | null;
  lastErrorAt: string | null;
  lastErrorText: string | null;
  publicConfig: Record<string, string>;
  supportsOutbound: boolean;
  setupSteps: string[];
  requiredEnv: string[];
}

const STATUS_META: Record<
  IntegrationCardData["status"],
  { label: string; variant: any; hint: string }
> = {
  NOT_CONFIGURED: {
    label: "Not configured",
    variant: "muted",
    hint: "No credentials set. Add the environment variables, then subscribe the webhook.",
  },
  SETUP_INCOMPLETE: {
    label: "Setup incomplete",
    variant: "gold",
    hint: "Some credentials are present but the connection is not finished.",
  },
  CONNECTED: {
    label: "Connected",
    variant: "success",
    hint: "Receiving events. Replies are enabled where the channel and window allow.",
  },
  PERMISSION_REQUIRED: {
    label: "Permission required",
    variant: "gold",
    hint: "The app is connected but a required permission or review is missing.",
  },
  ERROR: {
    label: "Connection error",
    variant: "danger",
    hint: "The last provider interaction failed. See the error below.",
  },
};

export function IntegrationCard({
  data,
  demoMode,
}: {
  data: IntegrationCardData;
  demoMode: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const meta = STATUS_META[data.status];
  const Icon = channelMeta(data.channel).icon;

  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 items-center justify-center rounded-md bg-champagne-100 text-gold-700">
            <Icon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-espresso">
              {channelMeta(data.channel).label}
            </p>
            <p className="text-[11px] text-muted-foreground">{data.label}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant={meta.variant}>{meta.label}</Badge>
              {!data.supportsOutbound && <Badge variant="outline">Ingestion only</Badge>}
              {data.lastEventAt && (
                <Badge variant="outline">Last event {data.lastEventAt}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          {demoMode && <Button size="sm" variant="outline" onClick={() => setSimOpen(true)}>
            <FlaskConical className="size-3.5" /> Send test event
          </Button>}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            Setup guide <ChevronDown className={"size-3.5 " + (open ? "rotate-180" : "")} />
          </Button>
        </div>
      </div>

      <p className="px-4 pb-3 text-[11px] text-espresso-500">{meta.hint}</p>

      {data.lastErrorText && (
        <div className="mx-4 mb-3 rounded-md bg-danger-50 px-3 py-2 text-[11px] text-danger-600">
          <span className="font-medium">Last error</span>
          {data.lastErrorAt ? ` (${data.lastErrorAt})` : ""}: {data.lastErrorText}
        </div>
      )}

      <div className="border-t border-border px-4 py-3">
        <Label>Webhook callback URL</Label>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-champagne-50 px-2.5 py-1.5 font-mono text-[11px] text-espresso-700">
            {data.webhookUrl}
          </code>
          <Button
            size="icon"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(data.webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label="Copy webhook URL"
          >
            {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <CredState label="App secret" ok={data.appSecretSet} />
          <CredState label="Verify token" ok={data.verifyTokenSet} />
          <CredState label="Access token" ok={data.accessTokenSet} />
        </div>

        {Object.keys(data.publicConfig).length > 0 && (
          <dl className="mt-3 space-y-1 text-[11px]">
            {Object.entries(data.publicConfig).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-espresso-700">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {open && (
        <div className="border-t border-border bg-champagne-50 px-4 py-3">
          <p className="text-xs font-semibold text-espresso-700">
            External setup steps (done in the provider's console)
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-espresso-500">
            {data.setupSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs font-semibold text-espresso-700">Environment variables</p>
          <ul className="mt-1 space-y-0.5 pl-1 font-mono text-[11px] text-espresso-500">
            {data.requiredEnv.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Check the provider's current documentation for API version, permission names and
            account eligibility before going live — these change.
          </p>
        </div>
      )}

      <Dialog
        open={simOpen}
        onClose={() => {
          setSimOpen(false);
          setResult(null);
        }}
        title={`Simulate a ${channelMeta(data.channel).label} event`}
        description="Runs a synthetic payload through the real ingestion pipeline (signature check → durable event → worker → identity → lead). The stored event is flagged SIMULATED."
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            start(async () => {
              const res = await simulateEventAction(
                data.channel,
                Object.fromEntries(fd.entries()) as any,
              );
              setResult(res.ok ? (res.detail ?? "Processed") : res.error);
              router.refresh();
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input name="name" defaultValue="Simulated Prospect" />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input name="phone" defaultValue="+919812345678" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input name="email" defaultValue="sim.prospect@example.com" />
            </div>
            <div className="space-y-1">
              <Label>Service interest</Label>
              <Input name="service" defaultValue="AI Calling Systems" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Message</Label>
            <Input name="message" defaultValue="Hi, can you share pricing for this?" />
          </div>
          {result && (
            <p className="rounded-md bg-champagne-50 px-3 py-2 text-[11px] text-espresso-700">
              {result}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {demoMode
              ? "Demo mode is on — nothing is sent to a real provider."
              : "This is a local simulation only. It does not prove your live provider connection works."}
          </p>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Processing…" : "Send simulated event"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function CredState({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={
        "rounded-md border px-2 py-1.5 " +
        (ok ? "border-emerald-100 bg-emerald-50" : "border-border bg-muted")
      }
    >
      <p className="text-muted-foreground">{label}</p>
      <p className={ok ? "font-medium text-emerald-600" : "text-espresso-500"}>
        {ok ? "Set" : "Not set"}
      </p>
    </div>
  );
}
