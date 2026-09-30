import type { Channel } from "@prisma/client";

/**
 * External setup steps per channel. These describe what must be done in the
 * PROVIDER's console — they are not performed by this app. Always confirm the
 * current API version, permission names, and eligibility rules against the
 * provider's live documentation before going to production.
 */
export const SETUP_GUIDE: Record<
  string,
  { steps: string[]; env: string[]; docs: string }
> = {
  WHATSAPP: {
    docs: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    steps: [
      "Create a Meta app (Business type) and add the WhatsApp product.",
      "Attach a WhatsApp Business Account (WABA) and register a phone number; complete business verification.",
      "Create a System User with a long-lived access token scoped to the WABA (whatsapp_business_messaging, whatsapp_business_management).",
      "In the app's Webhooks section, subscribe the WhatsApp Business Account to the `messages` field.",
      "Set the callback URL below and the verify token to WHATSAPP_VERIFY_TOKEN, then complete the GET handshake.",
      "Submit message templates for approval — required to start a conversation or reply outside the 24-hour customer service window.",
      "Confirm opt-in/consent for every recipient before messaging them.",
    ],
    env: [
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_WABA_ID",
    ],
  },
  WHATSAPP_TWILIO: {
    docs: "https://www.twilio.com/docs/whatsapp/quickstart",
    steps: [
      "Create a Twilio account and copy the Account SID and Auth Token from the Console dashboard.",
      "For testing: Messaging → Try it out → Send a WhatsApp message to open the WhatsApp Sandbox. Each tester sends the 'join <code>' message to the sandbox number first.",
      "For production: register your own number as a WhatsApp Sender (Messaging → Senders → WhatsApp senders) and complete Meta business verification through Twilio.",
      "Set 'When a message comes in' (sandbox settings, or the sender's configuration) to the webhook URL below, method POST.",
      "Put TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886) in the environment and restart.",
      "Twilio signs the exact URL you configure — if it differs from APP_URL + /api/webhooks/whatsapp, set TWILIO_WEBHOOK_URL to it.",
      "Business-initiated messages (and replies after 24 hours) need a Meta-approved template created in Twilio's Content Template Builder.",
      "Confirm opt-in/consent for every recipient before messaging them.",
    ],
    env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "TWILIO_MESSAGING_SERVICE_SID (optional)", "TWILIO_WEBHOOK_URL (optional)"],
  },
  META_LEAD_ADS: {
    docs: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads",
    steps: [
      "Create/choose a Meta app and add the Webhooks product for the `page` object.",
      "Request the leads_retrieval and pages_show_list permissions (App Review required for production).",
      "Generate a long-lived Page access token for the Page that owns the lead forms.",
      "Subscribe the Page to the `leadgen` webhook field with the callback URL below.",
      "Map each form's field names to CRM fields (the CRM maps common names automatically; review after the first live lead).",
      "Historical import is limited by the provider's retention window — confirm the current limit before relying on it.",
      "A lead form submission does NOT grant permission to message the person on WhatsApp/Messenger. Obtain consent separately.",
    ],
    env: [
      "META_LEADADS_APP_SECRET",
      "META_LEADADS_VERIFY_TOKEN",
      "META_LEADADS_PAGE_ACCESS_TOKEN",
    ],
  },
  MESSENGER: {
    docs: "https://developers.facebook.com/docs/messenger-platform",
    steps: [
      "Add the Messenger product to your Meta app and connect the Facebook Page.",
      "Request pages_messaging (and pages_manage_metadata) — App Review required for production.",
      "Generate a Page access token and subscribe the Page to `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`.",
      "Set the callback URL below with MESSENGER_VERIFY_TOKEN.",
      "Note: senders are identified only by a Page-Scoped ID (PSID). No phone or email is provided — the CRM never invents one.",
      "Standard messaging is limited to 24 hours after the user's last message; outside it a valid message tag is required.",
    ],
    env: [
      "MESSENGER_APP_SECRET",
      "MESSENGER_VERIFY_TOKEN",
      "MESSENGER_PAGE_ACCESS_TOKEN",
      "MESSENGER_PAGE_ID",
    ],
  },
  INSTAGRAM: {
    docs: "https://developers.facebook.com/docs/messenger-platform/instagram",
    steps: [
      "The Instagram account must be a Professional (Business/Creator) account linked to a Facebook Page.",
      "In the Instagram app settings, enable 'Allow access to messages'.",
      "Request instagram_basic and instagram_manage_messages permissions (App Review required).",
      "Subscribe the app to the Instagram `messages` webhook field with the callback URL below.",
      "Identities are Instagram-scoped IDs (IGSID). The CRM keeps them separate from other channels until a reliable identifier or a manual review links them.",
    ],
    env: [
      "INSTAGRAM_APP_SECRET",
      "INSTAGRAM_VERIFY_TOKEN",
      "INSTAGRAM_ACCESS_TOKEN",
      "INSTAGRAM_ACCOUNT_ID",
    ],
  },
  WEBSITE_FORM: {
    docs: "Local — see docs/INTEGRATIONS.md",
    steps: [
      "Point your website's enquiry form at the endpoint below (POST, JSON).",
      "Optionally sign the raw JSON body with HMAC-SHA256 using WEBSITE_FORM_SIGNING_SECRET and send it as `x-form-signature`.",
      "Include a hidden `website` honeypot field — submissions that fill it are silently dropped.",
      "Forward utm_source / utm_medium / utm_campaign / utm_content / utm_term, `referrer` and `landing` for attribution.",
      "Never put a privileged API key in browser code — this endpoint is public by design and rate-limited per IP.",
      "A working example form ships at /enquiry.",
    ],
    env: ["WEBSITE_FORM_SIGNING_SECRET", "WEBSITE_FORM_RATE_PER_MINUTE"],
  },
};

export function webhookPath(channel: Channel): string {
  return (
    {
      WHATSAPP: "/api/webhooks/whatsapp",
      META_LEAD_ADS: "/api/webhooks/meta-lead-ads",
      MESSENGER: "/api/webhooks/messenger",
      INSTAGRAM: "/api/webhooks/instagram",
      WEBSITE_FORM: "/api/public/enquiry",
    } as Record<string, string>
  )[channel] ?? "/api/webhooks";
}
