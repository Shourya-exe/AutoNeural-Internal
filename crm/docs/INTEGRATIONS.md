# Integrations — setup and status

Every adapter in this project is **implemented in code**. None of them is **connected** until you supply credentials and complete the provider-side configuration and (where required) app review.

The Integrations page shows five honest states per channel:

| State | Meaning |
| --- | --- |
| **Not configured** | No credentials set |
| **Setup incomplete** | Some credentials present, connection unfinished |
| **Connected** | Receiving events; replies enabled where the channel and window allow |
| **Permission required** | App connected but a permission or review is missing |
| **Connection error** | The last provider interaction failed (error shown, secrets never shown) |

A successful **simulated** event proves the ingestion pipeline works. It does **not** prove a live provider connection, and the UI says so.

> **Check the provider's current documentation before going live.** Meta changes
> API versions, permission names, eligibility rules and messaging windows
> regularly. The version pinned in code today is Graph API **v21.0**
> (`server/integrations/*.ts`); confirm it is still current and bump it if not.

---

## Webhook callback URLs

Replace the host with your deployment (`https://crm.autoneural.in`):

| Channel | Callback URL |
| --- | --- |
| WhatsApp Business Platform | `/api/webhooks/whatsapp` |
| Facebook / Instagram Lead Ads | `/api/webhooks/meta-lead-ads` |
| Facebook Messenger | `/api/webhooks/messenger` |
| Instagram messaging | `/api/webhooks/instagram` |
| Website enquiry form | `/api/public/enquiry` |

All four Meta webhooks answer the `GET` subscription handshake (`hub.mode` / `hub.verify_token` / `hub.challenge`) and verify every `POST` against `X-Hub-Signature-256` computed over the **raw** body with the app secret.

These paths are **excluded from the site-wide Basic-Auth wall** — Meta cannot send Basic credentials. They are protected by signature verification instead.

---

## A. WhatsApp Business Platform (Meta Cloud API)

**Implemented:** GET verification, signature verification, inbound text/media message normalization, delivery & read status callbacks with a monotonic state machine, outbound text send, 24-hour customer-service-window enforcement.

**Not usable without:** a verified Meta Business, a WhatsApp Business Account (WABA), a registered phone number, and approved templates for anything outside the 24-hour window.

### External steps

1. Create a Meta app (Business type) and add the **WhatsApp** product.
2. Attach a WABA and register a phone number. Complete business verification.
3. Create a **System User** with a long-lived token scoped to the WABA, with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. In **Webhooks**, subscribe the WABA to the `messages` field.
5. Set the callback URL and `WHATSAPP_VERIFY_TOKEN`, then complete the GET handshake.
6. Submit message templates for approval.
7. Record opt-in/consent for every recipient before messaging them.

### Environment

```dotenv
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WABA_ID=
```

### Messaging rules enforced in code

- A reply is blocked when there is **no inbound message** — the UI explains that an approved template is required to open the conversation.
- A reply is blocked when the last inbound message is **older than 24 hours**.
- An accepted send is stored as **`SENT`**, never `DELIVERED`. Only a provider status callback promotes a message to `DELIVERED` or `READ`.

### Explicitly not done

No browser scraping, no unofficial personal-WhatsApp session automation. Official API only.

---

## B. Meta Lead Ads (Facebook & Instagram lead forms)

**Implemented:** GET verification, signature verification, `leadgen` event normalization, Graph API retrieval of full field data by `leadgen_id`, field mapping into CRM fields, provider lead ID / form ID / campaign / ad attribution, duplicate-import prevention, retrieval-failure recording and retry.

**Ingestion only.** This channel has no `sendText`, and the inbox explains that a lead form is not a messaging channel.

### External steps

1. Add the **Webhooks** product for the `page` object.
2. Request `leads_retrieval` and `pages_show_list` (App Review required for production).
3. Generate a long-lived **Page access token** for the Page that owns the forms.
4. Subscribe the Page to the `leadgen` field with the callback URL.
5. Review the field mapping after your first live lead.

### Environment

```dotenv
META_LEADADS_APP_SECRET=
META_LEADADS_VERIFY_TOKEN=
META_LEADADS_PAGE_ACCESS_TOKEN=
```

### Field mapping

A real `leadgen` webhook carries only a `leadgen_id`; the CRM fetches the rest with `GET /{leadgen_id}`. Common field names are mapped automatically:

| Form field (any of) | CRM field |
| --- | --- |
| `full_name`, `name` | Contact full name |
| `email` | Contact email (lower-cased) |
| `phone_number`, `phone` | Contact phone (normalised to E.164) |
| `company_name` | Contact company |
| anything matching `service` / `interested` / `product` / `requirement` | Interested service |
| `message` | Written to the lead timeline |

Provider `leadgen_id`, `form_id`, `campaign_id`, `campaign_name` and `ad_id` are stored verbatim on the lead.

### Retrieval failures

A failed Graph call marks the `WebhookEvent` **FAILED** with a `nextRetryAt`, and the worker retries with exponential backoff. After 6 attempts it becomes **DEAD_LETTER** and an Admin can replay it from Settings → Integrations. The lead is created only once retrieval succeeds — a partial lead is never written.

### Historical import

Meta limits how far back lead data can be retrieved, and the limit changes. The CRM does not pretend otherwise: import what the API returns and show its real bounds.

### Consent

**A lead-form submission does not grant permission to message that person on WhatsApp or Messenger.** Consent must be obtained separately; the messaging channels enforce their own windows regardless.

---

## C. Facebook Messenger

**Implemented:** GET verification, signature verification, inbound message normalization, delivery/read events, Page-scoped ID (PSID) identity tracking, conversation and lead creation, outbound send.

### External steps

1. Add the **Messenger** product and connect the Facebook Page.
2. Request `pages_messaging` (and `pages_manage_metadata`) — App Review required.
3. Generate a Page access token; subscribe the Page to `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`.
4. Set the callback URL and `MESSENGER_VERIFY_TOKEN`.

### Environment

```dotenv
MESSENGER_APP_SECRET=
MESSENGER_VERIFY_TOKEN=
MESSENGER_PAGE_ACCESS_TOKEN=
MESSENGER_PAGE_ID=
```

### Identity

Messenger gives you a **PSID only**. The CRM stores it as the channel identity and **never invents a phone number or email address** for a Messenger user. A Messenger contact links to an existing contact only when a reliable identifier later confirms it, or a human merges them.

---

## D. Instagram messaging

**Implemented:** GET verification, signature verification, inbound message normalization, IGSID identity tracking, conversation and lead creation, outbound send.

### External steps

1. The Instagram account must be **Professional** (Business/Creator) and linked to a Facebook Page.
2. Enable *Allow access to messages* in the Instagram app settings.
3. Request `instagram_basic` and `instagram_manage_messages` — App Review required.
4. Subscribe to the Instagram `messages` webhook field.

### Environment

```dotenv
INSTAGRAM_APP_SECRET=
INSTAGRAM_VERIFY_TOKEN=
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_ACCOUNT_ID=
```

### Identity

Instagram identities are **kept separate** from other channels until a reliable identifier or a manual review links them to an existing contact. An IGSID carries no phone or email, so an Instagram DM from an existing customer creates a distinct contact by design rather than guessing.

---

## E. Website enquiry form

**Implemented and working today** — no provider approval needed.

- Example form: **`/enquiry`**
- Endpoint: **`POST /api/public/enquiry`**

### Protections

| Protection | Detail |
| --- | --- |
| Rate limit | Per IP, `WEBSITE_FORM_RATE_PER_MINUTE` (default 5), returns 429 with `Retry-After` |
| Honeypot | Hidden `website` field; a filled value is accepted silently and dropped |
| Signature | Optional HMAC-SHA256 of the raw body in `x-form-signature` |
| Validation | Zod schema; at least one of email or phone required |
| Duplicate guard | Same email/phone/message within the same minute is deduplicated |

### Payload

```json
{
  "name": "Vikram Sharma",
  "email": "vikram@nimbus.com",
  "phone": "+91 98123 45678",
  "company": "Nimbus Retail",
  "service": "WhatsApp Automation",
  "message": "We miss half our WhatsApp enquiries.",
  "consent": true,
  "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "brand-search",
  "referrer": "https://www.google.com/",
  "landing": "https://autoneural.in/services",
  "pageUrl": "https://autoneural.in/contact",
  "website": ""
}
```

### Signing (recommended)

```js
const body = JSON.stringify(payload);
const sig = crypto.createHmac("sha256", WEBSITE_FORM_SIGNING_SECRET).update(body).digest("hex");
fetch("https://crm.autoneural.in/api/public/enquiry", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-form-signature": sig },
  body,
});
```

Compute the signature **server-side on autoneural.in**. Never put the signing secret in browser code — the endpoint is public by design and works without a signature; the secret only adds origin assurance.

---

## F. Future channels

The adapter interface (`server/integrations/types.ts`) already covers what an email or calling provider would need: `verifySignature`, `normalize`, `buildSimulatedPayload`, optional `sendText` and `checkSendWindow`.

**Email** and **Calling providers** appear on the Integrations page under **Planned**, with a note that no implementation ships. They are never shown as connected, and no code claims otherwise.

To add one: implement `ChannelAdapter`, register it in `server/integrations/registry.ts`, add a webhook route that calls `makeWebhookHandlers(<CHANNEL>)`, and add its setup steps to `server/integrations/setup-guide.ts`.

---

## The local simulator

**Settings → Integrations → Send test event** builds a payload shaped like the real provider webhook and runs it through the **actual** ingestion pipeline: signature check → durable `WebhookEvent` → worker → normalization → identity resolution → lead/conversation/message → automations.

Simulated events are stored with `isSimulated: true` and rendered with a **Simulated** badge everywhere they appear. They are never counted as evidence that a real account is connected.

The command-line equivalent, which sends genuinely HMAC-signed HTTP requests to the running app:

```bash
node scripts/demo-walkthrough.mjs
```

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Webhook returns **401** | App secret mismatch, or a proxy altered the body before signature verification |
| GET verification returns **403** | `*_VERIFY_TOKEN` does not match what you typed in the Meta console |
| Events stored but nothing happens | Worker not running (`pm2 status`), or Redis unreachable |
| Events **FAILED** with a Graph error | Token expired or a permission was revoked — see the error in Settings → Integrations, fix it, then **Replay** |
| Replies blocked on WhatsApp | Outside the 24-hour window, or the connection is not `CONNECTED` |
| Duplicate contacts appearing | Expected when identifiers genuinely differ (e.g. an IGSID with no phone). Merge manually — the CRM will not guess |
