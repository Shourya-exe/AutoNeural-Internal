# Tests — inventory and actual results

```bash
npm test
```

Requires a running PostgreSQL. The suite creates and migrates a separate
`<database>_test` database automatically (`tests/global-setup.ts`), runs with
`DEMO_MODE=false` so the real gating logic is exercised, and forces inline
processing (`REDIS_URL=""`) so no external queue is needed.

---

## Result of the run recorded here

```
Test Files  9 passed (9)
     Tests  82 passed (82)
  Duration  ~8s
```

Environment: Node 24.18.1 · PostgreSQL 17.5 · Vitest 2.1.8 · Windows 11.

---

## What each requirement is covered by

| Required verification | Covered by |
| --- | --- |
| Valid and invalid webhook signatures | `webhook-signature.test.ts` (10 tests) |
| Duplicate webhook delivery creating only one stored message or lead | `ingestion.test.ts` (4 tests) |
| Lead Ads field mapping and retrieval retry | `lead-ads.test.ts` (5 tests) |
| Identity matching without unsafe contact merging | `identity.test.ts` (12 tests) |
| Role-based access restrictions | `rbac.test.ts` (9 tests) |
| Persistent stage changes and follow-up tasks | `pipeline-tasks.test.ts` (8 tests) |
| Failed outbound messages showing the correct state | `outbound.test.ts` (12 tests) |
| Automation retries without repeated customer messages | `automations.test.ts` (7 tests) |
| Scheduler sweeps (hosts with no worker process) | `sweeps.test.ts` (9 tests) |

---

## Full test list

### `tests/webhook-signature.test.ts` — signature & handshake

```
✓ accepts a correctly signed WhatsApp payload
✓ rejects a payload signed with the wrong secret
✓ rejects a payload whose body was tampered with after signing
✓ rejects a payload with no signature header at all
✓ rejects a malformed signature header
✓ verifies each Meta adapter against its own app secret only
✓ never validates when the configured secret is empty
✓ returns the challenge when mode and verify token match
✓ returns null for a wrong verify token
✓ returns null when the mode is not subscribe
```

### `tests/ingestion.test.ts` — durable, exactly-once ingestion

```
✓ creates exactly one contact, lead, conversation and message from one delivery
✓ processing the SAME event twice stores only one message and one lead
✓ a re-delivered webhook with the same provider message id is a no-op
✓ a second message from the same person does NOT create a second lead
✓ records the original source and adds later channels as touchpoints
✓ applies delivery status callbacks and never downgrades the state
✓ marks an unprocessable event FAILED with a retry time, then DEAD_LETTER
✓ recovers a dead-lettered event on replay once the provider works again
✓ the adapter's simulated payload flows through the real pipeline
```

### `tests/lead-ads.test.ts` — Meta Lead Ads

```
✓ normalizes a leadgen webhook into a lead event with provider attribution
✓ maps form fields onto CRM fields when the event is applied
✓ does not import the same provider lead twice
✓ retries retrieval when the Graph call fails, then succeeds
✓ is an ingestion-only channel — it never offers outbound messaging
```

### `tests/identity.test.ts` — identity resolution

```
✓ normalises Indian numbers written in several styles to one E.164 value
✓ returns null rather than guessing for unparseable input
✓ still normalises when libphonenumber metadata fails to load
✓ reuses the contact when the same channel identity is seen again
✓ links a new channel to an existing contact on an exact E.164 phone match
✓ links on an exact email match
✓ NEVER merges two people who only share a name
✓ flags an ambiguous match for review instead of picking one contact
✓ keeps Instagram identities separate from other channels
✓ never invents a phone number or email for a Messenger user
✓ backfills missing contact details without overwriting existing ones
✓ scopes identities to the organization
```

### `tests/rbac.test.ts` — roles enforced server-side

```
✓ gives Sales Reps the day-to-day capabilities only
✓ gives Managers team-level capabilities but not admin ones
✓ gives Admins everything
✓ requireCan throws ForbiddenError for a missing capability
✓ blocks a Sales Rep from assigning a lead to someone else
✓ allows a Sales Rep to assign a lead to themselves
✓ allows a Manager to reassign to anyone
✓ blocks a Sales Rep from archiving or merging leads
✓ never reaches a lead in another organization
```

### `tests/pipeline-tasks.test.ts` — pipeline & follow-ups

```
✓ persists the stage and records it on the activity timeline
✓ writes an audit entry for every stage change
✓ requires a reason to move a lead to Lost and stores it
✓ marks a lead Won with a timestamp and no lost reason
✓ creates a demo-prep task when the opportunity reaches Demo Scheduled
✓ does not create a demo-prep task for any other stage
✓ assigns round-robin, notifies the owner and creates a first follow-up task
✓ rotates round-robin assignment across eligible members
```

### `tests/outbound.test.ts` — send gating & delivery state

```
✓ blocks sending on a channel that is not CONNECTED
✓ blocks sending on Lead Ads with a useful explanation
✓ blocks WhatsApp sending outside the 24-hour customer service window
✓ blocks WhatsApp sending when there has been no inbound message at all
✓ allows sending inside the window on a connected channel
✓ stores an accepted send as SENT — never DELIVERED
✓ stores a rejected send as FAILED with the provider error
✓ stores a thrown transport error as FAILED, not SENT
✓ a FAILED send does not set the lead's first-response timestamp
✓ a successful send sets first-response exactly once
✓ internal notes are stored but never sent, even when sending is blocked
✓ refuses a customer-facing send when the channel is not eligible
```

### `tests/sweeps.test.ts` — scheduler sweeps

Shared by the always-on worker and `GET /api/cron/sweep`, so a host that cannot
run a second process (Hostinger Cloud) gets identical behaviour.

```
✓ drains an event that was persisted but never processed
✓ recovers an event abandoned mid-processing by a dead worker
✓ leaves a recently-started PROCESSING event alone
✓ reminds about a lead with no human response past the SLA
✓ escalates an overdue follow-up
✓ running every minute does NOT produce a notification every minute
✓ stops reminding once a human has replied
✓ one org's failure does not stop another org's sweep
✓ reports a duration and never throws
```

### `tests/automations.test.ts` — idempotent rule engine

```
✓ running the same trigger repeatedly performs the work only once
✓ a disabled rule does nothing and records no run
✓ task creation is idempotent on its dedupe key
✓ the NO_RESPONSE sweep reminds once per SLA bucket, not once per sweep
✓ skips the no-response reminder once a human has replied
✓ records a FAILED run instead of throwing when a rule handler errors
✓ no seeded rule is allowed to send a customer-facing message
```

---

## Bugs these tests caught during development

Recording them because they are the reason the suite exists.

1. **`createLead` wrote its timeline entry inside the creating transaction.**
   `writeActivity` uses the global Prisma client, so the `Activity` insert
   referenced a `Lead` row that was not yet visible outside the transaction —
   a foreign-key violation on every lead creation. Fixed by moving the activity
   and audit writes to after the transaction commits.

2. **Automation failures could not be recorded.**
   `AutomationRun.leadId` has a foreign key; when a rule fired for a lead that
   no longer existed, the *failure record itself* failed to insert — so the one
   case where visibility matters most produced nothing. Fixed by verifying the
   lead exists before linking the run, and logging non-race insert errors.

3. **Phone normalisation silently returned `null` in the worker.**
   `libphonenumber-js` throws from `isSupportedCountry` when its metadata bundle
   fails to load under some CJS/bundler combinations. The `try/catch` swallowed
   it, so a bare 10-digit number produced `null`, which meant a Lead Ads contact
   and a later WhatsApp contact for the same person were **not** matched and a
   duplicate contact was created. Fixed with a deterministic metadata-free
   fallback, plus a regression test that mocks the library into failure.

---

## End-to-end walkthrough

Separate from the unit/integration suite, this drives the **running application**
over HTTP with genuinely HMAC-signed webhook requests:

```bash
npm run dev            # terminal 1
npm run worker         # terminal 2
node scripts/demo-walkthrough.mjs
```

Actual output from the run recorded here:

```
1. A person submits the Facebook lead form
   ✓ webhook acknowledged (200) — stored 1 event(s)
   ✓ lead created: "Walkthrough Demo Lead"
   ✓ source preserved as META_LEAD_ADS · campaign "Q3 AI Agents — Lead Gen"
   ✓ phone normalised to E.164: +919812340001

2. Automations assign a salesperson
   ✓ assigned to Ananya Nair (round-robin)

3. A follow-up task appears
   ✓ task "First follow-up: Walkthrough Demo Lead" due 2026-09-09T21:17:22.197Z (UTC)
   ✓ owner notified (2 notification)

4. The same person messages on WhatsApp — identity established by phone
   ✓ webhook acknowledged (200)
   ✓ linked to the SAME contact — no duplicate created
   ✓ original lead source still META_LEAD_ADS
   ✓ WhatsApp recorded as a subsequent touchpoint
   ✓ conversation opened with 1 message(s)

5. The provider re-delivers the SAME message (at-least-once delivery)
   ✓ acknowledged again (200) — duplicates reported: 1
   ✓ message count unchanged (40) — exactly-once storage

5b. A forged webhook with a bad signature is rejected
   ✓ rejected with 401 before anything was stored

6. The salesperson replies from the unified inbox
   ✓ reply stored with deliveryStatus=SENT (not "Delivered")

7. The opportunity moves through the pipeline
   ✓ moved to Contacted (persisted + on the activity timeline)
   ✓ moved to Qualified (persisted + on the activity timeline)
   ✓ moved to Demo Scheduled (persisted + on the activity timeline)

8. Dashboard metrics recompute from stored data
   ✓ new leads (30d): 38
   ✓ unassigned: 4
   ✓ overdue follow-ups: 19
   ✓ open pipeline value: ₹1,62,50,000
   ✓ lead timeline now has 8 entries
```

---

## Other verification performed

| Check | Command | Result |
| --- | --- | --- |
| Type checking | `npm run typecheck` | clean, no errors |
| Production build | `npm run build` | succeeds; 31 routes compiled |
| Health endpoint | `curl /api/health` | `{"status":"healthy","checks":{"database":"ok","queue":"redis"}}` |
| Basic-Auth wall — no credentials | `curl -i /` | `401` + `WWW-Authenticate: Basic realm="AutoNeural CRM"` |
| Basic-Auth wall — wrong password | `curl -u autoneural:wrong /` | `401` |
| Basic-Auth wall — correct password | `curl -u autoneural:<pw> /` | `200` |
| Basic-Auth bypass — health | `curl /api/health` | `200` (no credentials) |
| Basic-Auth bypass — public form page | `curl /enquiry` | `200` (no credentials) |
| Basic-Auth bypass — webhook | `curl /api/webhooks/whatsapp` | `403` from verify-token check, **not** a 401 auth wall |
| Cron sweep — no secret | `curl /api/cron/sweep` | `401` |
| Cron sweep — wrong secret | `curl -H "x-cron-secret: wrong" …` | `401` |
| Cron sweep — correct secret | `curl -H "x-cron-secret: … " …` | `200` + JSON summary |
| Cron sweep — Bearer form | `curl -H "Authorization: Bearer …" …` | `200` |
| Cron sweep — idempotent | 4 consecutive calls | notification count unchanged at 160 |
| Cron sweep — drains stranded event | insert `RECEIVED` event, then sweep | lead created, event `PROCESSED` |
| Supabase — schema applied | `SELECT` against the project | 23 tables, 17 enums |
| Supabase — API locked down | `SELECT` against the project | RLS on 23/23, 0 policies, 0 anon grants |
| Supabase — advisors | `get_advisors(security)` | only `rls_enabled_no_policy` at INFO (intended) |
| `create-admin.mjs` — validation | missing/short/invalid input | rejects each with a clear message |
| `create-admin.mjs` — happy path | run against local DB | Admin created, bcrypt round-trip verifies |

## Not verified

- **The Supabase connection from the running app.** The schema, lock-down and
  seed were applied through Supabase's management API, which does not expose the
  database password. Until you paste the two connection strings into the
  environment, the app has not actually connected to that database. Everything
  else was verified against a local PostgreSQL 17 with the identical schema.
- **The Hostinger Cloud deployment itself** — hPanel steps, the cron job firing
  on their scheduler, and SSL issuance are all unperformed.
- **Live provider traffic.** No real WhatsApp / Messenger / Instagram / Lead Ads
  account was connected. Every webhook test uses locally generated payloads with
  locally generated signatures. Real send/receive remains unverified until
  credentials and Meta App Review are in place.
- **Browser coverage.** Verified in Chromium at 1440×900 and 375×812. Not tested
  in Safari or Firefox.
- **Load.** No performance or concurrency testing beyond the worker's
  concurrency-8 default.
