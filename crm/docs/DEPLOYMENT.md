# Deployment — AutoNeural CRM

Target: **`crm.autoneural.in`**, a subdomain of `autoneural.in`, behind an HTTP Basic-Auth password wall.

> Hostinger's panel changes. Verify menu names in hPanel as you go — the
> requirements below are what the application actually needs and don't change.

---

## Read this first: what Hostinger Cloud does and doesn't give you

| Need | Hostinger Cloud | Hostinger VPS |
| --- | --- | --- |
| Node.js app (Next.js) | ✅ via hPanel | ✅ |
| **PostgreSQL** | ❌ **Not available** — VPS-only | ✅ |
| **Redis** | ❌ **Not available** — VPS-only | ✅ |
| Second always-on process (the worker) | ❌ One app process | ✅ |
| Cron jobs | ✅ | ✅ |
| Free SSL on a subdomain | ✅ | ✅ (certbot) |

Hostinger's own documentation is explicit: *"Since PostgreSQL requires a larger amount of system resources and memory, along with specific configurations and permissions that aren't available on Web and Cloud hosting plans, VPS Hosting is the supported option"* — and the same for Redis. Cloud plans give you **MySQL only**.

This app is **PostgreSQL-only** (the schema uses enums, `Json`, `Decimal` and case-insensitive search). So on Cloud you need **two changes**, both of which are now built in:

1. **An external managed PostgreSQL.** **Supabase** on whichever account owns your production data. Two commands set it up (schema + lockdown + your Admin); you paste two connection strings into the environment.
2. **A cron job instead of the worker.** `GET /api/cron/sweep` does exactly what the always-on worker's periodic sweep does. Point Hostinger's cron at it.

Redis is simply left out on Cloud: with `REDIS_URL` blank the webhook route processes events inline, and the cron sweep picks up anything that gets stranded.

**If you'd rather keep everything on one box**, take [Option B — VPS](#option-b--hostinger-vps). Both paths are fully documented below.

---

## Option A — Hostinger Cloud

Architecture:

```
Meta / your website ──► crm.autoneural.in  (Hostinger Cloud, Node.js app)
                              │
                              ├──► Supabase (PostgreSQL 17, Mumbai, TLS)
                              │
        hPanel cron ─────────►│  GET /api/cron/sweep
        (every minute)             = follow-up reminders, overdue escalations,
                                     webhook retries, stranded-event drain
```

### 1. Create the Supabase project

Use whichever Supabase account owns your production data. Any account works —
nothing in this project is tied to a particular one.

1. **New project** → name it `autoneural-crm`.
2. **Region:** `ap-south-1` (Mumbai) for an India-based team. This cannot be
   changed later without migrating, so pick it deliberately.
3. **Save the database password Supabase generates.** It is shown once. If you
   lose it: **Project Settings → Database → Database password → Reset**.

The free tier is sufficient for this workload.

### 2. Get your two connection strings

From **Project Settings → Database → Connection string**, copy both. Substitute
your own project reference and region — the shapes below are illustrative:

**`DATABASE_URL`** — Transaction pooler (port 6543), used by the app at runtime:

```
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**`DIRECT_URL`** — Session pooler connection (port 5432, IPv4 compatible), used for migrations and DDL:

```
postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

*(Note: `db.PROJECT_REF.supabase.co:5432` is IPv6-only on Supabase free tier and can fail on standard IPv4 networks. Using the session pooler on port 5432 resolves cleanly on IPv4 and IPv6).*

**Why two.** A transaction pooler cannot hold prepared statements or advisory
locks, so Prisma migrations fail against it. `prisma/schema.prisma` declares both
(`url` and `directUrl`), so the app gets safe pooled connections while migrations
get a real session. `pgbouncer=true&connection_limit=1` is what keeps a pooled
Prisma client correct — do not drop those parameters.

### 3. Apply the schema and bootstrap

Two commands from your machine, both against the **direct** URL:

```bash
DATABASE_URL="DIRECT_URL_HERE" DIRECT_URL="DIRECT_URL_HERE" npx prisma migrate deploy
```

```bash
DATABASE_URL="DIRECT_URL_HERE" ADMIN_NAME="Your Name" ADMIN_EMAIL="you@autoneural.in" ADMIN_PASSWORD="a-long-strong-password" npm run db:bootstrap
```

The bootstrap is idempotent — re-running it changes nothing — and does three things:

1. **Locks down PostgREST** (see below).
2. **Seeds the structure the app needs**: the AutoNeural organization, 8 pipeline
   stages, 6 services, 5 tags, 4 automation rules (none able to message a
   customer), and 5 integration placeholders, all honestly `NOT_CONFIGURED`.
3. **Creates your Admin** — bcrypt at 12 rounds, password read from the
   environment and never logged.

It creates **no** demo contacts, leads, conversations or tasks. Omit the
`ADMIN_*` variables to skip step 3 and run `npm run db:admin` separately later.

Expected output:

```
  [done] PostgREST locked down — RLS on 24/24 tables, 0 policies, 0 anon grants
  [done] Structure seeded — 8 stages, 6 services, 5 tags, 4 automation rules, 5 integration placeholders
  [done] Admin ready — Your Name <you@autoneural.in>
```

#### Why the lockdown matters

Supabase automatically publishes every table in the `public` schema over its
PostgREST API, readable with the project's **anon key** — a key designed to be
public and normally shipped in browser code. Left at defaults, that would make
every lead, contact, message and audit entry in this CRM readable, and writable,
by anyone who ever saw that key.

The bootstrap enables Row Level Security on **every table with zero policies**
and revokes the blanket `anon` / `authenticated` grants, including default
privileges for tables created later. That denies the API completely. The
application is unaffected because Prisma connects as `postgres`, which owns the
tables and therefore bypasses RLS. (`FORCE ROW LEVEL SECURITY` is deliberately
*not* used — that would lock out Prisma too.)

Verified against a Supabase-shaped database: the owner role reads normally,
while `anon` and `authenticated` are denied both `SELECT` and `INSERT`.

Supabase's linter will report `rls_enabled_no_policy` at INFO level for these
tables. That finding is expected and correct here — policies would only matter if
you intended to serve traffic through PostgREST, and this app never does.

#### Re-applying migrations later

```bash
DATABASE_URL="POOLER_URL" DIRECT_URL="DIRECT_URL" npx prisma migrate deploy
```

### 4. Create the subdomain

hPanel → **Domains → autoneural.in → Subdomains** → create `crm`.

Because the domain is already on Hostinger, DNS is handled for you. Confirm:

```bash
dig crm.autoneural.in +short
```

### 5. Create the Node.js application

hPanel → **Advanced → Node.js** (or **Website → Node.js app**):

| Setting | Value |
| --- | --- |
| Node.js version | 22.x (20.12+ minimum) |
| Application root | the folder your code is deployed to |
| Application URL | `crm.autoneural.in` |
| Application startup file | `server.js` |
| Build command | `npm ci && npx prisma generate && npm run build` |
| Start command | `node server.js` |

`server.js` ships with the project — a small Next.js entrypoint for hosts that want a single startup file rather than `npm start`.

> **Build on the server. Never upload `node_modules`.** Prisma downloads a
> platform-specific query engine; a `node_modules` folder built on Windows or
> macOS will not run on Hostinger's Linux. Deploy source only and let the build
> command install. This is the single most common way this deployment fails.

### 6. Environment variables

hPanel → your Node.js app → **Environment variables**. Do not commit these.

```dotenv
# Supabase transaction pooler — runtime
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
# Supabase direct connection — migrations only, must always be set
DIRECT_URL=postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres

APP_URL=https://crm.autoneural.in
DISPLAY_TIMEZONE=Asia/Kolkata
DEFAULT_CURRENCY=INR

AUTH_SECRET=<npx auth secret>
AUTH_TRUST_HOST=true

DEMO_MODE=false

# No Redis on Cloud — leave blank. Webhooks process inline; the cron sweep
# catches anything that gets stranded.
REDIS_URL=

INTEGRATION_ENCRYPTION_KEY=<openssl rand -base64 32>

# Site-wide password wall
BASIC_AUTH_USER=autoneural
BASIC_AUTH_PASSWORD=<a long shared password>
BASIC_AUTH_REALM=AutoNeural CRM

# Scheduler-driven background work — REQUIRED on Cloud
CRON_SECRET=<openssl rand -hex 32>
```

### 7. Schedule the sweep — this is not optional

Without it, follow-up reminders, overdue escalations and webhook retries never fire.

hPanel → **Advanced → Cron Jobs**, every minute:

```bash
curl -fsS -m 50 -H "x-cron-secret: YOUR_CRON_SECRET" https://crm.autoneural.in/api/cron/sweep >/dev/null
```

If hPanel's minimum interval is 5 minutes, use that — reminders are simply up to 5 minutes later. Every sweep action is idempotent, so a frequent schedule cannot produce duplicate notifications or tasks. There is a test for exactly that (`tests/sweeps.test.ts` → *"running every minute does NOT produce a notification every minute"*).

The endpoint:

- returns `401` without the secret, and `503` when `CRON_SECRET` is unset — it fails closed;
- compares the secret in constant time;
- is exempt from the Basic-Auth wall, because a cron job cannot answer a password prompt — the secret replaces it;
- returns a summary you can eyeball in the cron log:

```json
{"ok":true,"organizations":1,"drainedEvents":0,"retriedEvents":0,
 "noResponseChecked":6,"overdueChecked":26,"durationMs":210,"errors":[]}
```

If you prefer an external scheduler, [cron-job.org](https://cron-job.org) or a GitHub Actions schedule work identically.

### 8. SSL

hPanel → **Security → SSL** → issue the free certificate for `crm.autoneural.in`. Meta will not deliver webhooks over plain HTTP or to an invalid certificate, and Basic Auth is only meaningful over HTTPS.

### 9. Verify

```bash
curl -i https://crm.autoneural.in/
curl -i -u autoneural:PASSWORD https://crm.autoneural.in/
curl -s https://crm.autoneural.in/api/health
curl -s -H "x-cron-secret: SECRET" https://crm.autoneural.in/api/cron/sweep
```

Expect `401` then `200`, a health payload with `"database":"ok"`, and a sweep summary.

`/api/health` will report `"queue":"inline-fallback"` on Cloud. That is correct — it means there is no Redis and the cron sweep is your safety net.

### 10. Complete API & URL Directory for `crm.autoneural.in`

Every active public URL, webhook callback, internal API, and Supabase endpoint:

#### Public URLs & App Pages
| Resource | URL | Description |
| --- | --- | --- |
| Main App / Dashboard | `https://crm.autoneural.in/` | Pipelines, Leads, Inbox, Tasks & Reports |
| Sign In | `https://crm.autoneural.in/login` | Email & password authentication |
| Public Enquiry Page | `https://crm.autoneural.in/enquiry` | Standalone enquiry capture form |

#### Ingestion & Webhook Endpoints
| Service | Endpoint URL | Method | Auth / Protection |
| --- | --- | --- | --- |
| Website Form Ingestion | `https://crm.autoneural.in/api/public/enquiry` | `POST` | Honeypot + Rate Limit (5/min) + optional HMAC |
| WhatsApp Webhook | `https://crm.autoneural.in/api/webhooks/whatsapp` | `GET`, `POST` | `hub.verify_token` + `X-Hub-Signature-256` |
| Meta Lead Ads Webhook | `https://crm.autoneural.in/api/webhooks/meta-lead-ads` | `GET`, `POST` | `hub.verify_token` + `X-Hub-Signature-256` |
| Messenger Webhook | `https://crm.autoneural.in/api/webhooks/messenger` | `GET`, `POST` | `hub.verify_token` + `X-Hub-Signature-256` |
| Instagram Webhook | `https://crm.autoneural.in/api/webhooks/instagram` | `GET`, `POST` | `hub.verify_token` + `X-Hub-Signature-256` |

#### Operational & Background Endpoints
| Service | Endpoint URL | Method | Auth / Protection |
| --- | --- | --- | --- |
| Health Check | `https://crm.autoneural.in/api/health` | `GET` | Public (database + queue status) |
| Cron Sweep | `https://crm.autoneural.in/api/cron/sweep` | `GET`, `POST` | `x-cron-secret` header |
| Auth Handler | `https://crm.autoneural.in/api/auth/*` | `GET`, `POST` | NextAuth CSRF / JWT session |
| Leads CSV Export | `https://crm.autoneural.in/api/leads/export` | `GET` | Authenticated session |
| Attachment Download | `https://crm.autoneural.in/api/attachments/:id` | `GET` | Authenticated session + Org scoped |
| AI Assistant | `https://crm.autoneural.in/api/ai` | `POST` | Authenticated session |
| Notifications Stream | `https://crm.autoneural.in/api/notifications` | `GET`, `POST` | Authenticated session |

#### Supabase Database & APIs
| Endpoint | Value | Usage |
| --- | --- | --- |
| Project URL | `https://zyrdxpzewyfdxhwxmxib.supabase.co` | Supabase root endpoint |
| REST API | `https://zyrdxpzewyfdxhwxmxib.supabase.co/rest/v1` | PostgREST (locked down by RLS) |
| Auth API | `https://zyrdxpzewyfdxhwxmxib.supabase.co/auth/v1` | Supabase GoTrue auth |
| Transaction Pooler | `aws-0-ap-south-1.pooler.supabase.com:6543` | `DATABASE_URL` (Port 6543 with PgBouncer flags) |
| Session Pooler (IPv4) | `aws-0-ap-south-1.pooler.supabase.com:5432` | `DIRECT_URL` (Port 5432 for migrations & DDL) |

### What you give up versus a VPS

Worth knowing before you commit:

- **Webhook responses are slower.** With no queue, the provider's request waits for the event to be persisted *and* processed. Fine at AutoNeural's volume; a single large batched delivery does more work inline.
- **Reminders are cron-granular**, not near-instant.
- **An external database adds a network hop.** Pick a nearby region and keep `connection_limit` low.
- **Two vendors to manage.** Back up the database provider separately.

None of these break anything. But if the CRM becomes central to how the team sells, the VPS path is less to think about.

---

## Option B — Hostinger VPS

### Automated (recommended): `scripts/deploy/deploy.sh`

One command provisions a fresh Ubuntu 22.04/24.04 VPS and deploys everything: Node.js 24,
PostgreSQL, Redis, Caddy (automatic HTTPS), the CRM + worker + **voice agent** under pm2.

1. Add `~/.ssh/autoneural_deploy.pub` as an SSH key for `root` on the VPS (hPanel → VPS → SSH keys).
2. hPanel → Domains → autoneural.in → DNS: **A record** `demo` → the VPS IP.
3. Put provider keys (LiveKit, Deepgram, Gemini, Twilio…) in the local `.env`; the script copies
   them and adds production overrides (see `scripts/deploy/make-env.mjs`).
4. Run:

```bash
VPS_HOST=YOUR_VPS_IP ADMIN_EMAIL=you@autoneural.in ./scripts/deploy/deploy.sh
```

The first run seeds demo data, creates your Admin with a generated password (saved to
`.deploy/admin-credentials.txt`), and scrambles the published demo-account passwords.
Re-run the same command to ship updates. The server's voice agent registers under its own
LiveKit name (`rapidx-demo-riya`) so it never shares calls with a laptop worker.

The manual steps below remain as reference.

Everything on one box: PostgreSQL, Redis, the app and the worker.

### 1. Provision and secure

```bash
ssh root@VPS_IP
adduser autoneural && usermod -aG sudo autoneural
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Work as `autoneural` from here on.

### 2. Install the stack

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql postgresql-contrib redis-server nginx certbot python3-certbot-nginx git
sudo systemctl enable --now postgresql redis-server nginx
sudo npm install -g pm2
```

### 3. Create the database

```bash
sudo -u postgres createuser autoneural --pwprompt
sudo -u postgres createdb autoneural_crm --owner autoneural
```

Keep PostgreSQL and Redis bound to `localhost` (the defaults). Never expose 5432 or 6379.

### 4. Deploy

```bash
sudo mkdir -p /var/www/autoneural-crm
sudo chown autoneural:autoneural /var/www/autoneural-crm
cd /var/www/autoneural-crm
git clone YOUR_REPO_URL .
npm ci
cp .env.example .env && nano .env
chmod 600 .env
npx prisma migrate deploy
npm run build
```

Use the same values as Option A, except:

- `DATABASE_URL` and `DIRECT_URL` both point at `localhost:5432` — a single-endpoint PostgreSQL needs no pooler split
- `REDIS_URL=redis://localhost:6379`
- `CRON_SECRET` stays blank — the worker runs instead

### 5. Run both processes under PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command `pm2 startup` prints, then `pm2 save` again. That starts `autoneural-crm` (Next.js on 127.0.0.1:3000) and `autoneural-worker` (BullMQ consumer plus the sweeps).

### 6. nginx reverse proxy

Create `/etc/nginx/sites-available/crm.autoneural.in`:

```nginx
server {
    listen 80;
    server_name crm.autoneural.in;
    client_max_body_size 12M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # The app reads Authorization for its Basic-Auth wall — do not strip it,
        # and do not add a second nginx auth_basic block.
        proxy_set_header   Authorization     $http_authorization;
        proxy_pass_header  Authorization;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm.autoneural.in /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d crm.autoneural.in
```

Point an A record for `crm` at the VPS IP in hPanel → **Domains → autoneural.in → DNS**.

---

## The Basic-Auth password wall

Implemented in `middleware.ts`, active whenever **both** `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are set. It sits **in front of** the app's own sign-in.

**Deliberately bypassed** — a browser prompt would break these:

| Path | Why it bypasses | Protected by instead |
| --- | --- | --- |
| `/api/webhooks/*` | Meta cannot send Basic credentials | `X-Hub-Signature-256` HMAC verification |
| `/api/public/*` | Posted by visitors on autoneural.in | Per-IP rate limit, honeypot, optional HMAC |
| `/api/cron/*` | A cron job cannot answer a prompt | `CRON_SECRET`, constant-time compared |
| `/enquiry` | The public example form | Read-only page |
| `/api/health` | Uptime monitoring | Exposes no data |

Notes:

- Basic Auth sends the password on every request — only meaningful over **HTTPS**.
- It is a shared secret, not per-person identity. Accountability comes from the app's own sign-in and audit log; this wall keeps the subdomain off the open internet.
- Middleware reads the values at startup, so **restart the app after changing them** (hPanel → Restart, or `pm2 restart autoneural-crm`).
- To disable it, blank both variables and restart.

---

## Creating the first real user

There is no public sign-up. `npm run db:bootstrap` creates your Admin when the
`ADMIN_*` variables are set. To add one later, or to reset a password:

```bash
DATABASE_URL="DIRECT_URL_HERE" ADMIN_NAME="Your Name" ADMIN_EMAIL="you@autoneural.in" ADMIN_PASSWORD="a-strong-password" npm run db:admin
```

Use the **direct** URL. The script creates the organization and pipeline stages
if they are missing, hashes the password with bcrypt at 12 rounds, never logs it,
and is safe to re-run — an existing user is promoted to Admin and their password
updated. Add the rest of the team in **Settings → Team**.

---

## Updating a deployment

**Cloud:** push to your repo (or re-upload source), then hPanel → your Node.js app → **Rebuild / Restart**. If the release includes a schema change, run `npx prisma migrate deploy` against the production `DATABASE_URL` **before** restarting.

**VPS:**

```bash
cd /var/www/autoneural-crm
git pull && npm ci
npx prisma migrate deploy
npm run build
pm2 restart autoneural-crm autoneural-worker
```

Migrate before restarting, so new code never meets an old schema.

---

## Backups

**Cloud:** Supabase's backups are your backups. On the free tier that means
daily backups with limited retention and **no point-in-time recovery**. If the
CRM becomes business-critical, either upgrade the Supabase project or schedule
your own `pg_dump` against `DIRECT_URL` on a machine you control.

**VPS:** a nightly dump at 02:00 IST:

```bash
0 2 * * * pg_dump -U autoneural autoneural_crm | gzip > /var/backups/crm-$(date +\%F).sql.gz
```

Either way, also back up:

- your environment variables — **`INTEGRATION_ENCRYPTION_KEY` especially. Lose it and stored provider tokens cannot be decrypted.**
- the `.uploads/` directory (attachments).

---

## Operational checks

| Check | Cloud | VPS |
| --- | --- | --- |
| App up | `curl -s .../api/health` | `pm2 status` |
| Background work running | Cron log, or call `/api/cron/sweep` by hand | `pm2 logs autoneural-worker` |
| App logs | hPanel → Node.js app → Logs | `pm2 logs autoneural-crm` |
| Failed webhooks | Settings → Integrations → *Recent webhook events* | same |
| Automation failures | Settings → Automations → *Execution history* | same |
| Who changed what | Settings → Audit log | same |

---

## Security checklist before going live

- [ ] `DEMO_MODE=false`
- [ ] `AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY` freshly generated, not the examples
- [ ] `BASIC_AUTH_PASSWORD` set, long, and HTTPS working
- [ ] `CRON_SECRET` set (Cloud) — and the cron job actually firing
- [ ] Every seeded `@autoneural.demo` account deleted or disabled (Settings → Team)
- [ ] Environment variables not in version control
- [ ] Database reachable only over TLS (Cloud) or bound to localhost (VPS)
- [ ] `npm run db:bootstrap` run against production — RLS enabled on all tables, zero anon grants
- [ ] Supabase database password saved somewhere safe — it is shown only once
- [ ] Backups on, and a restore tested once
- [ ] Provider webhooks pointed at `https://crm.autoneural.in/api/webhooks/...` with their app secrets set

Sources: [Which databases are supported at Hostinger](https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/), [Hostinger Node.js hosting](https://www.hostinger.com/nodejs-hosting), [Node.js in hPanel](https://www.hostinger.com/support/hpanel/node-js/)
