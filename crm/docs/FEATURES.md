# Features — what's built, what still needs you

Legend: **✅ Working** · **🟡 Built, needs external setup** · **⬜ Not built**

---

## Core CRM

| Feature | Status | Notes |
| --- | --- | --- |
| Authentication (Auth.js v5, credentials + bcrypt) | ✅ | JWT sessions; no public sign-up |
| Site-wide HTTP Basic-Auth wall | ✅ | Enabled by `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD`; webhooks, the public form and the cron endpoint bypass it |
| Roles: Admin / Manager / Sales Rep | ✅ | One capability map, enforced server-side on every operation |
| Demo mode with synthetic data | ✅ | Banner, auto-preview as demo Admin, all outbound provider calls blocked |
| Organization-scoped records | ✅ | Every query is filtered by `organizationId`; cross-org access tested |
| Audit log | ✅ | Every privileged mutation, with secrets redacted before writing |
| Attachments with access control | ✅ | Served through an authenticated route; no public URL, path-traversal guarded. Upload UI ⬜ |

## Overview dashboard

| Feature | Status |
| --- | --- |
| New leads, unassigned, awaiting first response, overdue follow-ups | ✅ |
| Open pipeline value, won value, conversion rate | ✅ |
| First-response time (median + average) | ✅ |
| Lead volume by source, leads by pipeline stage (Recharts) | ✅ |
| Recent enquiries, upcoming tasks | ✅ |
| Integration failures requiring attention | ✅ |
| Date-range filter driving every metric | ✅ |

All metrics come from stored data. Definitions are in the README and repeated on the Reports page.

## Leads

| Feature | Status |
| --- | --- |
| Searchable, sortable, paginated table | ✅ |
| Fields: name, company, phone, email, source, campaign, service, stage, priority, owner, value, created, last activity, next follow-up | ✅ |
| Filters: source, stage, salesperson, service, priority, tag, overdue follow-up, archived | ✅ |
| Add and edit leads | ✅ |
| Tags and notes | ✅ |
| Assignment and reassignment | ✅ |
| Bulk assignment and bulk stage update | ✅ |
| CSV import — field mapping, validation, duplicate preview | ✅ |
| CSV export (respects the active filters) | ✅ |
| Archive and restore | ✅ |
| Duplicate review and merge | ✅ |

## Lead profile

| Feature | Status |
| --- | --- |
| Contact and business information | ✅ |
| Channel identities with verification state | ✅ |
| Original acquisition source + subsequent touchpoints | ✅ |
| Sales stage, owner, deal value | ✅ |
| Full conversation and activity timeline (merged) | ✅ |
| Notes, tasks, follow-up schedule | ✅ |
| Campaign attribution from the provider | ✅ |
| Attachments with controlled access | ✅ |
| Audit history | ✅ |
| Quick actions: assign, note, follow-up, stage, open conversation | ✅ |
| Contacts and opportunities kept separate | ✅ |

## Unified inbox

| Feature | Status |
| --- | --- |
| Three-column layout | ✅ |
| Channel filters; assigned-to-me / unassigned / unread / resolved views | ✅ |
| Search, unread state, conversation assignment, open/resolved | ✅ |
| Internal notes visually separated and never sent | ✅ |
| Incoming/outgoing timestamps, delivery status from provider callbacks only | ✅ |
| Draft replies (per conversation, browser-local) | ✅ |
| Send gated on connection, messaging window and consent, with an explanation | ✅ |
| Attachment display | 🟡 Inbound attachments are stored and listed; a rich viewer is ⬜ |

“Delivered” is never shown from a successful API response — only a provider status callback sets it.

## Pipeline

| Feature | Status |
| --- | --- |
| Drag-and-drop Kanban: New → Contacted → Qualified → Demo Scheduled → Proposal Sent → Negotiation → Won / Lost | ✅ |
| Cards show lead, company, service, owner, value, next follow-up | ✅ |
| Stage changes persisted, recorded on the timeline, audited | ✅ |
| Lost requires a reason | ✅ |
| Optimistic move rolls back if the server rejects it | ✅ |

## Tasks and follow-ups

| Feature | Status |
| --- | --- |
| Create, edit, complete, reschedule | ✅ |
| Assign to team members | ✅ |
| Due dates, priorities, reminders | ✅ |
| Today / upcoming / overdue / completed views, mine vs team | ✅ |
| Linked to the related lead | ✅ |
| UTC storage, Asia/Kolkata display, INR values | ✅ |

## Reports

| Feature | Status |
| --- | --- |
| Leads by channel and campaign | ✅ |
| Pipeline conversion (from the activity trail) | ✅ |
| Won and lost, with loss reasons | ✅ |
| First human response time — median, average, p90 | ✅ |
| Salesperson workload | ✅ |
| Overdue follow-ups | ✅ |
| Restricted to Manager and Admin | ✅ |

## Settings

| Feature | Status |
| --- | --- |
| Team members and roles (+ generated capability matrix) | ✅ |
| Pipeline stages (rename; keys are stable) | ✅ |
| Services and lead tags | ✅ |
| Integration connections with five honest states | ✅ |
| Notification preferences | 🟡 In-app notifications ✅; email/push delivery is ⬜ and labelled as such |
| Automation settings with execution history | ✅ |
| Audit log | ✅ |
| Profile and workspace preferences | ✅ |

## Ingestion and identity

| Feature | Status |
| --- | --- |
| Signature verification on the raw body | ✅ |
| Durable event persistence before processing | ✅ |
| Prompt provider acknowledgement | ✅ |
| Background worker processing (BullMQ, inline fallback) | ✅ |
| Channel-specific normalization | ✅ |
| Idempotency via unique provider event and message IDs | ✅ |
| Safe duplicate and out-of-order handling | ✅ |
| Retries with exponential backoff | ✅ |
| Failed-event queue and admin replay | ✅ |
| Durable scheduling that survives restarts | ✅ |
| Scheduler-driven sweeps for hosts without a worker process (`/api/cron/sweep`) | ✅ |
| Stranded / abandoned event recovery | ✅ |
| Transactional writes where consistency matters | ✅ |
| Redacted logs and audit entries | ✅ |
| Integration health surfaced in the UI | ✅ |
| E.164 phone normalisation | ✅ |
| No merging on name alone; uncertain matches flagged | ✅ |
| Original lead source preserved across channels | ✅ |

## Automations

| Rule | Status |
| --- | --- |
| Assign a new lead (round-robin or fixed) | ✅ |
| Notify the assigned salesperson | ✅ |
| Create a follow-up task on capture | ✅ |
| Remind the owner when there is no human response within the SLA | ✅ |
| Escalate overdue follow-ups | ✅ |
| Create a preparation task at Demo Scheduled | ✅ |
| Enable/disable controls, execution history, failure visibility | ✅ |
| Customer-facing automated messages | ⬜ **Disabled by design.** No rule can send to a customer; `sendsCustomerMessage` is false everywhere and enabling it would require explicit configuration, consent and provider eligibility |
| Duplicate-send and loop prevention | ✅ Every rule execution is idempotent on `(ruleId, dedupeKey)` |

## AI assistance (optional)

| Feature | Status |
| --- | --- |
| Conversation summaries | 🟡 Needs `AI_PROVIDER` + `AI_API_KEY` |
| Suggested reply drafts | 🟡 Same |
| Extraction of service interest and requirements | 🟡 Same |
| Suggested next actions | 🟡 Same |
| Output labelled as a suggestion, editable | ✅ |
| Incoming messages treated as untrusted data, not instructions | ✅ Wrapped in a delimited block with an explicit instruction to ignore embedded commands |
| AI cannot change permissions, expose secrets, or send messages | ✅ No tool use, no write path to the messaging service |
| CRM fully usable without an AI key | ✅ Panel renders a clear disabled state |

---

## Channel integrations

| Channel | Code | What still needs you |
| --- | --- | --- |
| **Website enquiry form** | ✅ | Nothing. Point your site at `/api/public/enquiry`; optionally set `WEBSITE_FORM_SIGNING_SECRET` |
| **WhatsApp Business Platform** | ✅ Adapter, webhooks, send, 24h window, status callbacks | Meta Business verification, WABA + registered number, system-user token, webhook subscription, approved templates, recorded consent |
| **Meta Lead Ads** | ✅ Adapter, webhooks, Graph retrieval, field mapping, retry | `leads_retrieval` + `pages_show_list` permissions (App Review), Page access token, `leadgen` subscription |
| **Facebook Messenger** | ✅ Adapter, webhooks, PSID identity, send | `pages_messaging` permission (App Review), Page access token, webhook subscription |
| **Instagram messaging** | ✅ Adapter, webhooks, IGSID identity, send | Professional account linked to a Page, messaging access enabled, `instagram_manage_messages` (App Review) |
| **Email** | ⬜ | Adapter interface ready; shown as **Planned**, never as connected |
| **Calling providers** | ⬜ | Adapter interface ready; shown as **Planned**, never as connected |

Full per-channel steps: [`INTEGRATIONS.md`](INTEGRATIONS.md).

---

## Explicitly not implemented

These are deliberate, not oversights:

- **Customer-facing automated messaging.** Off by design.
- **Email / push notification delivery.** In-app notifications only; the preference toggles say so.
- **Email and calling channel adapters.** Interface defined, no implementation, shown as Planned.
- **Attachment upload UI.** Storage, access control and download exist; inbound provider attachments are captured. A staff upload form is not built.
- **Multi-organization onboarding.** The data model is org-scoped throughout, but there is no tenant sign-up flow — AutoNeural is a single organization.
- **Contact-level merge.** Lead merge is implemented; merging two *contacts* is intentionally left to a human decision and is not automated.

---

## Remaining external setup, in order

Target: **Hostinger Cloud** + **Supabase**. Full detail in [`DEPLOYMENT.md`](DEPLOYMENT.md).

1. **Create the Supabase project** on the account that should own your production data — name it `autoneural-crm`, region `ap-south-1` (Mumbai), and **save the database password** (shown once).
2. **Copy the two connection strings** — pooler for `DATABASE_URL`, direct for `DIRECT_URL`.
3. **Apply the schema and bootstrap** — `npx prisma migrate deploy` then `npm run db:bootstrap` with your `ADMIN_*` variables. That locks down PostgREST, seeds the structure, and creates your Admin in one pass.
4. **Create the subdomain + Node.js app in hPanel** — startup file `server.js`, build `npm ci && npx prisma generate && npm run build`.
5. **Set the environment variables** — `AUTH_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `BASIC_AUTH_*`, `CRON_SECRET`, `DEMO_MODE=false`, `REDIS_URL` blank.
6. **Schedule the cron sweep** — every minute against `/api/cron/sweep`. Without it, reminders and escalations never fire.
7. **Issue the SSL certificate** for `crm.autoneural.in`.
8. **Wire the website form** on autoneural.in to `/api/public/enquiry`.
9. **Create the Meta app**, then per channel: request permissions → App Review → tokens → webhook subscription → paste the callback URL from Settings → Integrations.
10. **Submit WhatsApp templates** for anything sent outside the 24-hour window.
11. **Record consent** for every contact you intend to message.
12. *(Optional)* Set `AI_PROVIDER` and `AI_API_KEY` to turn on summaries and suggested drafts.
