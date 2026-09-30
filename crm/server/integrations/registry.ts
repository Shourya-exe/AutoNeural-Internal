import type { Channel } from "@prisma/client";
import type { ChannelAdapter } from "./types";
import { env } from "@/lib/env";
import { whatsappAdapter } from "./whatsapp";
import { twilioWhatsappAdapter } from "./twilio-whatsapp";
import { metaLeadAdsAdapter } from "./meta-lead-ads";
import { messengerAdapter } from "./messenger";
import { instagramAdapter } from "./instagram";
import { websiteFormAdapter } from "./website-form";
import { sheetFeedAdapter, indiamartAdapter, leadApiAdapter } from "./lead-sources";

const ADAPTERS: Partial<Record<Channel, ChannelAdapter>> = {
  // WHATSAPP_PROVIDER picks Twilio (default when Twilio credentials exist) or Meta Cloud API.
  WHATSAPP: env.whatsappProvider === "twilio" ? twilioWhatsappAdapter : whatsappAdapter,
  META_LEAD_ADS: metaLeadAdsAdapter,
  MESSENGER: messengerAdapter,
  INSTAGRAM: instagramAdapter,
  WEBSITE_FORM: websiteFormAdapter,
  SHEET_FEED: sheetFeedAdapter,
  INDIAMART: indiamartAdapter,
  LEAD_API: leadApiAdapter,
};

export function getAdapter(channel: Channel): ChannelAdapter | undefined {
  return ADAPTERS[channel];
}

export function listAdapters(): ChannelAdapter[] {
  return Object.values(ADAPTERS).filter(Boolean) as ChannelAdapter[];
}

/**
 * Channels that are DESIGNED but intentionally not offered yet. The Integrations
 * page shows these as "Planned" — never "Connected".
 */
export const PLANNED_CHANNELS: { channel: Channel; label: string; note: string }[] = [
  { channel: "EMAIL", label: "Email (IMAP/SMTP or provider API)", note: "Adapter interface ready; no implementation shipped." },
  { channel: "PHONE", label: "Calling providers (Twilio / Exotel / Knowlarity)", note: "Adapter interface ready; no implementation shipped." },
];
