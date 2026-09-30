> **Autoneural production handover:** See [docs/AUTONEURAL-HANDOVER.md](docs/AUTONEURAL-HANDOVER.md) for the current company setup, login, Jio/Vobiz activation, and WhatsApp onboarding. Historical demo instructions below do not apply; `db:seed` now creates only production structure.

# AutoNeural CRM

Internal sales workspace for **AutoNeural** — AI agents, AI calling systems, WhatsApp automation, websites, custom software and business automation.

One place to capture every enquiry, assign it, talk to the customer, follow up, and close.

```
Incoming enquiry → automatic lead capture → salesperson assignment
        → conversation → follow-up → deal won or lost
```

---

## Contents

- [Stack](#stack)
- [Quick start](#quick-start)
- [Running the background worker](#running-the-background-worker)
- [Demo mode](#demo-mode)
- [Project layout](#project-layout)
- [How the ingestion pipeline works](#how-the-ingestion-pipeline-works)
- [Metric definitions](#metric-definitions)
- [Roles and permissions](#roles-and-permissions)
- [Tests](#tests)
- [Further documentation](#further-documentation)

---

## Stack

| Concern | Choice | Version |
| --- | --- | --- |
| Framework | Next.js (App Router) | 15.5.25 |
| Language | TypeScript | 5.7.2 |
| UI | Tailwind CSS + shadcn-style primitives | 3.4.17 |
| Icons | lucide-react | 0.469 |
| Database | PostgreSQL + Prisma | PG 17, Prisma 6.1 |
| Auth | Auth.js (NextAuth) v5, Credentials + bcrypt | 5.0.0-beta.25 |
| Background jobs | BullMQ + ioredis | 5.34 / 5.4 |
| Charts | Recharts | 2.15 |
| Validation | Zod | 3.24 |
| Drag & drop | @dnd-kit | 6.1 |
| Tests | Vitest | 2.1.8 |
| Runtime | Node.js | 20.12+ (developed on 24) |

All versions are pinned in `package.json`.

---

## Quick start

### 1. Requirements

- Node.js 20.12 or newer
- PostgreSQL 14+
- Redis 6+ *(optional — see [worker](#running-the-background-worker))*

### 2. Install

```bash
npm install
```

If your npm blocks lifecycle scripts (npm 11 `allow-scripts`), approve the ones this project needs:

```bash
npm approve-scripts prisma @prisma/client @prisma/engines esbuild unrs-resolver
```

### 3. Start PostgreSQL and Redis

**With Docker** (preferred if you have it):

```bash
docker compose up -d
```

**Without Docker** — a real, embedded PostgreSQL 17 is included for local development:

```bash
npm run db:local
```

This starts PostgreSQL on **port 55432** (avoiding a clash with any system PostgreSQL on 5432) with data in `./.localdb`. Leave it running in its own terminal. Redis is optional; without it the app processes webhooks inline.

### 4. Configure

```bash
cp .env.example .env
```

Then set at minimum:

```dotenv
# npm run db:local  (or …@localhost:5432/… for docker compose)
DATABASE_URL="postgresql://autoneural:autoneural@localhost:55432/autoneural_crm?schema=public"
# Used only for migrations. On a single-endpoint PostgreSQL, same value.
DIRECT_URL="postgresql://autoneural:autoneural@localhost:55432/autoneural_crm?schema=public"

AUTH_SECRET="<npx auth secret>"
INTEGRATION_ENCRYPTION_KEY="<openssl rand -base64 32>"
DEMO_MODE="true"
```

`DIRECT_URL` must always be set — Prisma errors if the variable is missing. It
exists so a connection-pooled production database (Supabase's transaction pooler)
can still run migrations over a real session. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### 5. Create the schema and load demo data

```bash
npm run db:migrate     # applies prisma/migrations
npm run db:seed        # clearly-labelled SYNTHETIC data
```

### 6. Run

```bash
npm run dev            # http://localhost:3000
npm run worker         # separate terminal — background jobs & SLA sweeps
```

Seeded sign-ins (password `autoneural123` for all):

| Email | Role |
| --- | --- |
| `admin@autoneural.demo` | Admin |
| `manager@autoneural.demo` | Manager |
| `rohan@autoneural.demo` | Sales Rep |
| `ananya@autoneural.demo` | Sales Rep |
| `kabir@autoneural.demo` | Sales Rep |

### 7. See the whole flow end to end

```bash
node scripts/demo-walkthrough.mjs
```

Sends **real HMAC-signed webhook requests** at the running app and asserts each step: lead-form capture → assignment → follow-up task → cross-channel identity link → duplicate-delivery safety → forged-signature rejection → reply → pipeline progression → dashboard update.

---

## Running the background worker

```bash
npm run worker         # development (watch)
npm run worker:start   # production
```

The worker does two things:

1. **Consumes the `webhook-ingestion` queue.** Webhook routes persist the provider event, acknowledge immediately, and enqueue the work.
2. **Runs periodic SLA sweeps every 60s** — drains stranded webhook events, retries failed ones with backoff, reminds owners about leads with no human response inside the SLA, and escalates overdue follow-ups.

**On hosting without a second always-on process** (Hostinger Cloud, most managed
Node hosting), the same sweep is available over HTTP at `GET /api/cron/sweep`,
protected by `CRON_SECRET`. Point a scheduler at it every minute and you get
identical behaviour — the logic lives in one place
(`server/services/sweeps.ts`) and every action is idempotent, so running both the
worker and the cron is harmless.

**Without Redis:** if `REDIS_URL` is unset or unreachable, the webhook route processes the event **inline** in the request instead (logged clearly), so the whole pipeline still works for local evaluation. The worker process is then only needed for the periodic sweeps. Redis is **required in production** so ingestion survives restarts and slow provider payloads don't block the HTTP response.

---

## Demo mode

`DEMO_MODE="true"`:

- shows a persistent **Demo mode** banner,
- resolves an unauthenticated visitor to the seeded demo Admin so the product can be previewed without credentials,
- **blocks every real outbound provider call** — replies are stored and shown as *Sent*, but nothing leaves the system.

Set `DEMO_MODE="false"` for real use. Nothing in the UI ever claims a real provider account is connected because a simulated event succeeded.

---

## Project layout

```
app/
  (app)/                     authenticated CRM shell
    page.tsx                 Overview dashboard
    leads/                   list, profile, new, CSV import (+ server actions)
    pipeline/                drag-and-drop Kanban
    inbox/                   three-column unified inbox
    tasks/                   today / upcoming / overdue
    reports/                 channel, conversion, response time, workload
    settings/                team, stages, catalog, integrations, automations,
                             notifications, audit log, profile
  api/
    webhooks/{whatsapp,meta-lead-ads,messenger,instagram}/
    public/enquiry/          public website-form endpoint (rate-limited)
    leads/export/            CSV export
    attachments/[id]/        access-checked download
    notifications/, health/, auth/
  enquiry/                   example public website form
  login/

components/                  UI primitives + feature components
server/
  auth/permissions.ts        pure capability map (no framework imports)
  auth/context.ts            session resolution + re-exports
  services/                  business logic
    identity.ts              contact / channel-identity resolution
    leads.ts                 create, assign, stage, archive, merge
    conversations.ts         messaging + send eligibility
    ingestion.ts             normalized-event processing, retries, dead letter
    automations.ts           idempotent rule engine
    metrics.ts               dashboard + report queries
    tasks.ts, notifications.ts, audit.ts, assignment.ts, lead-queries.ts
  integrations/              channel adapters + signature verification
  queue/queues.ts            BullMQ with inline fallback
worker/                      background worker entrypoint
prisma/                      schema, migrations, synthetic seed
scripts/                     local-db, demo walkthrough
tests/                       Vitest suite (real database)
docs/                        INTEGRATIONS, DEPLOYMENT, FEATURES, TESTS
```

The layering is: **UI components → API routes / server actions → services → Prisma**, with **integration adapters** and **background workers** on the side. Services never import request context; they take an `Actor`.

---

## How the ingestion pipeline works

Every inbound channel follows the same path:

1. **Verify** the webhook signature against the **raw** request body (`X-Hub-Signature-256`, HMAC-SHA256 with the app secret). A bad signature is rejected with 401 before anything is stored.
2. **Persist** a `WebhookEvent` row — unique on `(organizationId, channel, providerEventId)`.
3. **Acknowledge** the provider immediately (200). Processing never blocks the response.
4. **Process** in the background worker (BullMQ; inline fallback without Redis).
5. **Normalize** channel-specific payloads into a `NormalizedEvent`.
6. **Check** whether the event was already processed (unique constraints on both the event id and the provider message id).
7. **Resolve identity** — find or create the `Contact` and `ChannelIdentity`.
8. **Create or update** the lead, conversation and message.
9. **Apply automations** — assignment, notification, follow-up task.
10. **Notify** the owner; the dashboard reads the same stored data.

Reliability properties:

- Unique constraints on `WebhookEvent.providerEventId` and `Message.providerMessageId` — a duplicate delivery stores exactly one record.
- Retries with exponential backoff (~10s, 30s, 90s, 4.5m, 13.5m, 40m), then **dead letter** after 6 attempts.
- Failed / dead-lettered events are listed in **Settings → Integrations** and can be **replayed** by an Admin.
- Delivery-status callbacks are applied through a **monotonic state machine** — an out-of-order `delivered` never downgrades a `read`.
- Phone numbers are normalised to **E.164**; contacts are **never merged on a matching name**. Ambiguous matches create a new contact and are flagged for review.
- The **original lead source is preserved**; a later channel is recorded as a `Touchpoint`.
- Application logs and audit entries are **redacted** — tokens and secrets never reach them.

---

## Metric definitions

| Metric | Definition |
| --- | --- |
| New leads | `createdAt` within the selected period |
| Unassigned | status `OPEN`, not archived, no owner (point-in-time) |
| Awaiting first response | status `OPEN`, `firstInboundAt` set, `firstResponseAt` null |
| Overdue follow-ups | status `OPEN`, `nextFollowUpAt < now` (point-in-time) |
| Open pipeline value | Σ `estimatedValue` where status `OPEN` and not archived |
| Won value | Σ `estimatedValue` where status `WON` and `wonAt` in period |
| **Conversion rate** | `won / (won + lost)` counted by `wonAt` / `lostAt` in the period |
| **First response time** | `firstResponseAt − firstInboundAt`, reported as median, average and p90 |

`firstResponseAt` is set **only** when a human sales user sends an outbound reply that the provider accepted. Messages flagged `isAutomated` (automated acknowledgements) never set it. Leads with no inbound message are excluded from response-time statistics.

All timestamps are **stored in UTC**; the UI renders them in **Asia/Kolkata**. Deal values are **INR**.

---

## Roles and permissions

Three roles — **Admin**, **Manager**, **Sales Representative** — with a single capability map in `server/auth/permissions.ts`. Every service call checks it server-side; the UI only *reflects* it. Settings → Team renders that same map, so what you see is what the server enforces.

A few examples:

| Capability | Sales Rep | Manager | Admin |
| --- | :---: | :---: | :---: |
| Create / edit leads, move pipeline, send in inbox | ✅ | ✅ | ✅ |
| Assign leads to **other** people, bulk actions, import/export | — | ✅ | ✅ |
| View reports, view audit log | — | ✅ | ✅ |
| Team & roles, pipeline stages, integrations, automations, webhook replay | — | — | ✅ |

---

## Tests

```bash
npm test
```

Requires a running PostgreSQL — the suite creates and migrates a separate `<database>_test` database automatically. See [`docs/TESTS.md`](docs/TESTS.md) for the actual results and what each test proves.

---

## Further documentation

| Document | What's in it |
| --- | --- |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Per-channel setup, what's implemented, what needs provider approval |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deploying to Hostinger Cloud or VPS (`crm.autoneural.in`), Supabase, the Basic-Auth wall, the cron sweep, PM2, nginx, SSL |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Implemented features and remaining external setup |
| [`docs/TESTS.md`](docs/TESTS.md) | Test inventory and actual run output |
