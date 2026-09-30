import { Badge } from "@/components/ui/badge";
import type { Channel, Priority, LeadStatus, MessageDeliveryStatus } from "@prisma/client";
import {
  MessageCircle,
  Facebook,
  Instagram,
  Globe,
  Megaphone,
  Phone,
  Mail,
  PencilLine,
  Sheet,
  Store,
  Webhook,
} from "lucide-react";

export const CHANNEL_META: Record<Channel, { label: string; icon: any }> = {
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle },
  META_LEAD_ADS: { label: "Lead Ads", icon: Megaphone },
  MESSENGER: { label: "Messenger", icon: Facebook },
  INSTAGRAM: { label: "Instagram", icon: Instagram },
  WEBSITE_FORM: { label: "Website", icon: Globe },
  SHEET_FEED: { label: "Sheet", icon: Sheet },
  INDIAMART: { label: "IndiaMART", icon: Store },
  LEAD_API: { label: "Lead API", icon: Webhook },
  EMAIL: { label: "Email", icon: Mail },
  PHONE: { label: "Phone", icon: Phone },
  MANUAL: { label: "Manual", icon: PencilLine },
};

/** Safe lookup for values that arrive as plain strings from serialised props. */
export function channelMeta(channel: string): { label: string; icon: any } {
  return CHANNEL_META[channel as Channel] ?? { label: channel, icon: PencilLine };
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  const meta = CHANNEL_META[channel];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className="font-normal">
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const map: Record<Priority, { v: any; label: string }> = {
    LOW: { v: "muted", label: "Low" },
    MEDIUM: { v: "default", label: "Medium" },
    HIGH: { v: "gold", label: "High" },
    URGENT: { v: "danger", label: "Urgent" },
  };
  const m = map[priority];
  return <Badge variant={m.v}>{m.label}</Badge>;
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  if (status === "WON") return <Badge variant="success">Won</Badge>;
  if (status === "LOST") return <Badge variant="danger">Lost</Badge>;
  return <Badge variant="muted">Open</Badge>;
}

export function StageBadge({ name, isWon, isLost }: { name: string; isWon?: boolean; isLost?: boolean }) {
  return (
    <Badge variant={isWon ? "success" : isLost ? "danger" : "default"}>{name}</Badge>
  );
}

export function DeliveryBadge({ status }: { status: MessageDeliveryStatus }) {
  const map: Record<MessageDeliveryStatus, { v: any; label: string }> = {
    PENDING: { v: "muted", label: "Sending…" },
    SENT: { v: "outline", label: "Sent" },
    DELIVERED: { v: "default", label: "Delivered" },
    READ: { v: "success", label: "Read" },
    FAILED: { v: "danger", label: "Failed" },
    UNKNOWN: { v: "muted", label: "—" },
  };
  const m = map[status];
  return <Badge variant={m.v}>{m.label}</Badge>;
}
