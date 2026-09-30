/// <reference types="node" />
/**
 * Centralised, typed access to environment configuration.
 * Import this instead of reading process.env directly.
 */

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  directUrl: process.env.DIRECT_URL ?? "",
  appUrl: process.env.APP_URL ?? "https://crm.autoneural.in",
  displayTimezone: process.env.DISPLAY_TIMEZONE ?? "Asia/Kolkata",
  currency: process.env.DEFAULT_CURRENCY ?? "INR",
  companyPhone: "+916297927642",
  whatsappUrl: "https://wa.me/916297927642",

  supabase: {
    projectRef: process.env.SUPABASE_PROJECT_REF ?? "zyrdxpzewyfdxhwxmxib",
    region: process.env.SUPABASE_REGION ?? "ap-south-1",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://zyrdxpzewyfdxhwxmxib.supabase.co",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  /** Auth.js reads AUTH_SECRET itself and refuses to run without it in production. */
  authSecret: process.env.AUTH_SECRET ?? "",

  /** Demo mode: synthetic data and NO real outbound messaging-provider calls. */
  demoMode: bool(process.env.DEMO_MODE, false),

  /** Require sign-in. When false AND demo mode is on, visitors are auto-signed-in as the demo Admin. */
  authRequired: bool(process.env.AUTH_REQUIRED, true),

  redisUrl: process.env.REDIS_URL ?? "",

  /**
   * Encrypts integration tokens at rest. A missing key is an error in production: a
   * built-in default would mean every deployment encrypts secrets with a public key.
   * Read lazily so `next build` does not need it.
   */
  get integrationEncryptionKey(): string {
    const key = process.env.INTEGRATION_ENCRYPTION_KEY ?? "";
    if (key) return key;
    if (process.env.NODE_ENV === "production") {
      throw new Error("INTEGRATION_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
    }
    return "dev-insecure-32-byte-key-placeholder==";
  },

  ai: {
    provider: (process.env.AI_PROVIDER ?? "").toLowerCase(), // "" disables AI
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "claude-sonnet-5",
    get enabled() {
      return this.provider !== "" && this.apiKey !== "";
    },
  },

  websiteForm: {
    signingSecret: process.env.WEBSITE_FORM_SIGNING_SECRET ?? "",
    ratePerMinute: int(process.env.WEBSITE_FORM_RATE_PER_MINUTE, 5),
  },

  /**
   * WhatsApp provider. "twilio" (Twilio WhatsApp API) or "meta" (WhatsApp Cloud API).
   * Defaults to Twilio whenever Twilio credentials are present.
   */
  whatsappProvider: ((process.env.WHATSAPP_PROVIDER ??
    (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta")) as string).toLowerCase() === "meta"
    ? ("meta" as const)
    : ("twilio" as const),

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    /** Sender, e.g. "whatsapp:+14155238886" (sandbox) or your approved number. */
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? "",
    /** Optional Messaging Service SID; used instead of From when set. */
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
    /**
     * Public URL Twilio calls for this webhook, exactly as configured in the Twilio console.
     * Twilio signs that exact URL, so behind a proxy it cannot be derived from the request.
     * Defaults to APP_URL + /api/webhooks/whatsapp.
     */
    webhookUrl: process.env.TWILIO_WEBHOOK_URL ?? "",
    get configured() {
      return this.accountSid !== "" && this.authToken !== "" && (this.whatsappFrom !== "" || this.messagingServiceSid !== "");
    },
  },

  whatsapp: {
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    wabaId: process.env.WHATSAPP_WABA_ID ?? "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? "",
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en_US",
    tunnelSubdomain: process.env.WHATSAPP_TUNNEL_SUBDOMAIN ?? "autoneural-whatsapp",
    webhookPort: int(process.env.WEBHOOK_PORT, 8000),
  },
  metaLeadAds: {
    appSecret: process.env.META_LEADADS_APP_SECRET ?? "",
    verifyToken: process.env.META_LEADADS_VERIFY_TOKEN ?? "",
    pageAccessToken: process.env.META_LEADADS_PAGE_ACCESS_TOKEN ?? "",
  },
  messenger: {
    appSecret: process.env.MESSENGER_APP_SECRET ?? "",
    verifyToken: process.env.MESSENGER_VERIFY_TOKEN ?? "",
    pageAccessToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN ?? "",
    pageId: process.env.MESSENGER_PAGE_ID ?? "",
  },
  instagram: {
    appSecret: process.env.INSTAGRAM_APP_SECRET ?? "",
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? "",
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
    accountId: process.env.INSTAGRAM_ACCOUNT_ID ?? "",
  },

  // ════════════════════════════════════════════════════════════════
  // Autoneural AI CRM — voice agent, LLM, telephony, sheets
  // ════════════════════════════════════════════════════════════════
  livekit: {
    url: process.env.LIVEKIT_URL ?? "",
    apiKey: process.env.LIVEKIT_API_KEY ?? "",
    apiSecret: process.env.LIVEKIT_API_SECRET ?? "",
    get configured() {
      return this.url !== "" && this.apiKey !== "" && this.apiSecret !== "";
    },
  },

  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY ?? "",
    ttsModel: process.env.DEEPGRAM_TTS_MODEL ?? "aura-2-thalia-en",
    ttsProvider: process.env.TTS_PROVIDER ?? "deepgram",
  },

  llm: {
    provider: process.env.LLM_PROVIDER ?? "google", // groq | google | openai
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    googleApiKey: process.env.GOOGLE_API_KEY ?? "",
    googleApiKey2: process.env.GOOGLE_API_KEY_2 ?? "",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    sarvamApiKey: process.env.SARVAM_API_KEY ?? "",
    sarvamVoice: process.env.SARVAM_VOICE ?? "anushka",
  },

  vobiz: {
    sipTrunkId: process.env.VOBIZ_SIP_TRUNK_ID ?? "",
    outboundTrunkId: process.env.OUTBOUND_TRUNK_ID ?? "",
    sipDomain: process.env.VOBIZ_SIP_DOMAIN ?? "",
    username: process.env.VOBIZ_USERNAME ?? "",
    password: process.env.VOBIZ_PASSWORD ?? "",
    outboundNumber: process.env.VOBIZ_OUTBOUND_NUMBER ?? "",
    defaultTransferNumber: process.env.DEFAULT_TRANSFER_NUMBER ?? "",
  },

  agent: {
    healthPort: int(process.env.AGENT_HEALTH_PORT, 8082),
  },

  callLogging: {
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
    sheetId: process.env.GOOGLE_SHEET_ID ?? "",
    gcsBucket: process.env.GCS_RECORDINGS_BUCKET ?? "",
    gcsPrefix: process.env.GCS_RECORDINGS_PREFIX ?? "recordings",
    recordingEnabled: bool(process.env.RECORDING_ENABLED, true),
    recordingUrlTtl: int(process.env.RECORDING_URL_TTL_SECONDS, 3600),
  },

  billing: {
    razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
    jwtSecret: process.env.JWT_SECRET ?? "",
    trialDurationDays: int(process.env.TRIAL_DURATION_DAYS, 7),
  },
};

export type AppEnv = typeof env;
