"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHANNEL_META } from "@/components/domain/badges";
import { replayWebhookEventAction } from "@/app/(app)/settings/actions";
import { RefreshCw } from "lucide-react";

export interface WebhookEventRow {
  id: string;
  channel: any;
  providerEventId: string;
  status: string;
  attempts: number;
  signatureValid: boolean;
  isSimulated: boolean;
  error: string | null;
  receivedAt: string;
  nextRetryAt: string | null;
}

const STATUS_VARIANT: Record<string, any> = {
  RECEIVED: "muted",
  PROCESSING: "muted",
  PROCESSED: "success",
  FAILED: "danger",
  DEAD_LETTER: "danger",
  DUPLICATE: "outline",
};

export function WebhookEventsTable({ events }: { events: WebhookEventRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      {msg && (
        <p className="mx-5 mt-3 rounded-md bg-champagne-50 px-3 py-2 text-[11px] text-espresso-700">
          {msg}
        </p>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Channel</TH>
            <TH>Provider event ID</TH>
            <TH>Status</TH>
            <TH>Signature</TH>
            <TH>Attempts</TH>
            <TH>Received</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {events.map((e) => (
            <TR key={e.id}>
              <TD className="text-xs">
                {CHANNEL_META[e.channel as keyof typeof CHANNEL_META]?.label ?? e.channel}
                {e.isSimulated && (
                  <Badge variant="gold" className="ml-1.5">
                    Simulated
                  </Badge>
                )}
              </TD>
              <TD className="max-w-[220px] truncate font-mono text-[10px] text-muted-foreground">
                {e.providerEventId}
              </TD>
              <TD>
                <Badge variant={STATUS_VARIANT[e.status] ?? "muted"}>{e.status}</Badge>
                {e.error && (
                  <span className="mt-0.5 block max-w-[240px] truncate text-[10px] text-danger-600">
                    {e.error}
                  </span>
                )}
              </TD>
              <TD>
                <Badge variant={e.signatureValid ? "success" : "danger"}>
                  {e.signatureValid ? "Valid" : "Invalid"}
                </Badge>
              </TD>
              <TD className="text-xs tabular-nums">
                {e.attempts}
                {e.nextRetryAt && (
                  <span className="block text-[10px] text-muted-foreground">
                    retry {e.nextRetryAt}
                  </span>
                )}
              </TD>
              <TD className="whitespace-nowrap text-[11px] text-muted-foreground">
                {e.receivedAt}
              </TD>
              <TD>
                {["FAILED", "DEAD_LETTER"].includes(e.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await replayWebhookEventAction(e.id);
                        setMsg(res.ok ? (res.detail ?? "Replayed") : res.error);
                        router.refresh();
                      })
                    }
                  >
                    <RefreshCw className="size-3" /> Replay
                  </Button>
                )}
              </TD>
            </TR>
          ))}
          {events.length === 0 && (
            <TR>
              <TD colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                No webhook events yet. Use “Send test event” above.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </>
  );
}
