import type { Channel, Conversation } from "@prisma/client";

/**
 * A NormalizedEvent is the channel-agnostic shape the ingestion worker consumes.
 * Each adapter converts its raw provider payload into zero or more of these.
 */
export type NormalizedEventKind = "message" | "lead" | "status";

export interface NormalizedEvent {
  kind: NormalizedEventKind;
  channel: Channel;

  /** Stable provider event id — used for the WebhookEvent dedupe constraint. */
  providerEventId: string;

  /** Identity of the person on this channel. */
  identity: {
    externalId: string; // provider-scoped stable id
    displayName?: string | null;
    email?: string | null;
    phone?: string | null; // raw; normalised downstream
  };

  /** Conversation thread key on the provider side (messaging channels). */
  threadId?: string | null;

  /** For kind === "message". */
  message?: {
    providerMessageId: string;
    text?: string | null;
    type?: "TEXT" | "IMAGE" | "FILE" | "AUDIO" | "VIDEO" | "TEMPLATE" | "SYSTEM";
    timestamp?: Date | null;
    attachments?: { name: string; url: string; mime?: string }[];
    /** True when the provider marks this as an echo of our own outbound msg. */
    isEcho?: boolean;
  };

  /** For kind === "status" (delivery / read receipts). */
  status?: {
    providerMessageId: string;
    state: "SENT" | "DELIVERED" | "READ" | "FAILED";
    timestamp?: Date | null;
    error?: string | null;
  };

  /** For kind === "lead" (Lead Ads). */
  lead?: {
    providerLeadId: string;
    formId?: string | null;
    formName?: string | null;
    campaignId?: string | null;
    campaignName?: string | null;
    adId?: string | null;
    fields: Record<string, string>; // raw form field name -> value
  };

  /** Attribution passthrough. Written onto a newly-created lead. */
  attribution?: {
    campaignName?: string | null;
    campaignId?: string | null;
    adId?: string | null;
    sourceDetail?: string | null;
    /** Website-form UTM parameters and page context. */
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    referrerUrl?: string | null;
    landingUrl?: string | null;
  };
}

export interface VerifyResult {
  ok: boolean;
  /** organizationId resolved from the connection (single-tenant default). */
  organizationId?: string;
  reason?: string;
}

export interface SendResult {
  accepted: boolean;
  providerMessageId?: string | null;
  error?: string | null;
}

export interface ChannelAdapter {
  channel: Channel;
  /** Human label for UI. */
  label: string;
  /** Is this a two-way messaging channel (vs ingestion-only like Lead Ads)? */
  supportsOutbound: boolean;

  /** GET webhook verification (Meta hub.challenge). Returns the challenge string or null. */
  verifyChallenge?(query: URLSearchParams): string | null;

  /**
   * Verify the POST webhook signature against the raw body. `requestUrl` is the public
   * URL the provider called (Twilio signs the URL as well as the body).
   */
  verifySignature(rawBody: string, headers: Headers, requestUrl?: string): Promise<VerifyResult> | VerifyResult;

  /** Parse the raw body into a payload. Default: JSON. (Twilio posts form-encoded bodies.) */
  parsePayload?(rawBody: string, contentType: string | null): unknown;

  /** Body to acknowledge the provider with. Default: JSON `{ received: true }`. */
  ackResponse?(): { body: string; contentType: string };

  /** Convert a raw provider payload into normalized events. */
  normalize(payload: unknown): NormalizedEvent[];

  /** Build a synthetic-but-realistic payload for the local Simulator. */
  buildSimulatedPayload(input: SimulatedInput): { payload: unknown; providerEventId: string };

  /** Optional: send a text reply (messaging channels only). */
  sendText?(conversation: Conversation, text: string): Promise<SendResult>;

  /** Optional: check messaging window / template / consent before send. */
  checkSendWindow?(
    conversation: Conversation,
  ): Promise<{ ok: boolean; reason?: string }>;

  /** Optional: retrieve full lead detail from the provider (Lead Ads). */
  fetchLeadDetail?(providerLeadId: string): Promise<Record<string, string>>;
}

export interface SimulatedInput {
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  service?: string;
  campaignName?: string;
}
