# AutoNeural Workspace

The internal AutoNeural workspace: tasks and approvals, team mail, leads and pipeline, quotations/invoices and payments, WhatsApp inbox, AI calling, HR (attendance, leave, claims, payroll), automations, usage and audit — one Next.js app with a SQLite database.

`info@autoneural.in` is the **master admin**: always active and always an administrator. It is the only account that can create administrators or reset another administrator's password, it cannot be removed, and it may approve employee removals on its own. Other administrators need a second admin to approve a removal they requested.

This repository also contains separate applications with their own READMEs: `crm/` (sales CRM on PostgreSQL), `backend/` (NestJS API on PostgreSQL) and `web/` (its frontend), and `voice-agent/` (the Python calling agent). The workspace does not depend on `backend/`.

## Run locally

Requires Node.js 22.13+.

```sh
npm install
cp .env.example .env.local      # optional; every integration is optional
npm run setup                   # creates the master admin; password in output/CRM-INITIAL-LOGINS.txt
npm run dev                     # http://localhost:3000
```

`npm run dev:all` also starts the NestJS API from `backend/` (needs PostgreSQL and `backend/.env`).

## Configuration

All settings are environment variables, documented in [`.env.example`](.env.example). The essentials:

| Variable | Purpose |
| --- | --- |
| `CRM_APP_URL` | Exact public HTTPS origin, e.g. `https://work.autoneural.in`. Makes cookies `Secure`; used in email links and the CSRF check. |
| `CRM_DATABASE_PATH` | SQLite file. Absolute path on persistent disk, outside the web document root. |
| `CRM_UPLOAD_DIR` | Uploaded task files (default: `uploads/` next to the database). |
| `CRM_MAX_UPLOAD_MB` | Largest attachment (default 25). |
| `CRM_ADMIN_BOOTSTRAP_PASSWORD` | First start only: creates the master admin on an empty database. Remove after first sign-in. |
| `SMTP_*` or `RESEND_*` | Email delivery. Without it, production sends nothing and says so in the UI. |
| `MAIL_INBOUND_SECRET` | Enables the inbound email webhook `POST /api/mail/inbound`. |

WhatsApp, Facebook Lead Ads, Gemini AI, LiveKit calling, Exotel, Razorpay/Stripe and Zoom each switch on when their variables are set; the UI shows "not connected" otherwise and never simulates them.

Meta webhooks (both need the app secret, and a public HTTPS URL; use `ngrok http 3000` for local testing):

| Webhook | Meta setting | Field |
| --- | --- | --- |
| `/api/whatsapp/webhook` | App → WhatsApp → Configuration | `messages` |
| `/api/facebook/webhook` | App → Webhooks → Page, then **Leads → Subscribe Page** in the workspace | `leadgen` |

### AI calling agent (Riya)

"Start agent" runs `voice-agent/agent.py` with `AGENT_PYTHON`, else `voice-agent/.venv`, else the system Python — whichever can import the agent's packages. Create the virtualenv on the machine that runs the app; a venv copied from another operating system will not run.

```sh
# Windows
py -3 -m venv voice-agent\.venv
voice-agent\.venv\Scripts\python -m pip install -r voice-agent\requirements.txt
# macOS / Linux
python3 -m venv voice-agent/.venv
voice-agent/.venv/bin/python -m pip install -r voice-agent/requirements.txt
```

## Password resets

"Forgot your password?" on the sign-in page asks for a reset; nothing changes until an administrator approves it under **Team**. Any admin can approve an employee's reset; an administrator's reset needs the master admin; nobody approves their own. Approval sets a temporary password (changed at first sign-in), signs the person out everywhere, and emails it to the account owner — or shows it to the approving admin when email is not configured. A pending request is cancelled if the person signs in normally or is reset directly. The master admin recovers their own password on the server with `CRM_MASTER_ADMIN_RESET_PASSWORD`.

## How it works

- **Data**: SQLite in WAL mode (`node:sqlite`), migrated automatically at startup. Uploaded files are stored on disk under random names and served only through `GET /api/attachments/<id>`, which checks that the user can open the task.
- **Auth**: scrypt password hashes, random session tokens stored hashed, 8-hour `HttpOnly` `SameSite=Lax` cookies, forced password change for temporary passwords, login throttling per account and per IP, deactivated accounts rejected at sign-in and on every request, same-origin checks on every mutation.
- **Security headers**: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, restrictive `Permissions-Policy`; downloads of uploaded files are sandboxed.
- **Background work**: a one-minute loop (lead-source pulls, workflow queue, leave re-routing). Hostinger may idle-stop the app, so point a cron at `GET /api/leads/intake`.
- **Health**: `GET /api/health` returns database and upload-storage status (no configuration details).

## Deploy

- **Hostinger Cloud (SSH)**: `./deploy.sh <subdomain>` — see [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md). The database and uploads live in `~/autoneural-<subdomain>/data`, outside the document root. Schedule `deploy/backup.sh` daily; it snapshots the database and archives uploads.
- **Hostinger (ZIP upload)**: `npm run package:work`. The generated `.htaccess` blocks web access to `data/`, dotfiles and server files.
- **VPS with Docker**: `cp .env.production.example .env.production`, fill it in, then `docker compose up -d --build` (Caddy provides HTTPS; data persists in the `app_data` volume).
- **Any Node host**: `npm run build && npm start` with the variables above. Use one server with durable local storage; serverless/ephemeral hosting is not supported (SQLite and uploaded files are local).

Backups of a running server must use SQLite's backup (`VACUUM INTO`, as `deploy/backup.sh` does), not a plain file copy.

## Verify

```sh
npm run typecheck
npm test                         # unit + integration tests on temporary databases
npm run build
npx playwright install chromium  # first browser test only
npm run test:e2e                 # production server on :3219 with a temporary database
```

The browser test covers first-login password change, admin-approved password reset, admin/employee boundaries, task creation, comments and completion, task deep links, real file upload and download, workspace mail, CSRF rejection, logout, mobile layout and browser errors. Screenshots go to `output/crm-preview` (isolated sample data).
