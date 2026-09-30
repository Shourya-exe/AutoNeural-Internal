# Deploying AutoNeural on Hostinger Cloud (Subdomain of autoneural.in)

This guide provides instructions for deploying the AutoNeural application to any subdomain under **`autoneural.in`** (e.g., **`https://crm.autoneural.in`** or **`https://work.autoneural.in`**).

Both deployment models on Hostinger Cloud are supported:
1. **Hostinger Cloud Hosting (hPanel + LiteSpeed Passenger)** — Recommended if using your existing Hostinger Cloud/Shared hosting account.
2. **Hostinger Cloud VPS (Docker + Caddy)** — Recommended if using an Ubuntu/Debian Cloud VPS.

---

## Architecture Overview

| Component | Hostinger Cloud Hosting (hPanel) | Hostinger Cloud VPS (Docker) |
| :--- | :--- | :--- |
| **Runtime** | Node 24 LTS via LiteSpeed Passenger | Node 22/24 Alpine Container |
| **Web Server / SSL** | LiteSpeed + Hostinger Let's Encrypt SSL | Caddy 2 (Automated Let's Encrypt TLS) |
| **Document Root / Port** | `domains/autoneural.in/public_html/<subdomain>` | Port 80 & 443 (Reverse Proxy to 3000) |
| **Database** | SQLite WAL mode (`~/autoneural-<subdomain>/data/`) | Docker Volume (`app_data`) |
| **Upload Limit** | 50MB (configured in `.htaccess` & Next.js) | 50MB (configured in `deploy/Caddyfile`) |

---

## Quickest Option: Direct ZIP Upload via Hostinger File Manager

We have pre-built and packaged the complete production application and backend into:
- 📁 **[`autoneural-work-deployment.zip`](file:///c:/Users/Home/Shourya/professional/AutoNeural-Internal/AutoNeural-Internal/autoneural-work-deployment.zip)** (Fullstack App + Embedded Backend, configured for **`https://work.autoneural.in`**)
- 📁 **[`autoneural-crm-deployment.zip`](file:///c:/Users/Home/Shourya/professional/AutoNeural-Internal/AutoNeural-Internal/autoneural-crm-deployment.zip)** (Configured for **`https://crm.autoneural.in`**)
- 📁 **[`autoneural-hostinger-deployment.zip`](file:///c:/Users/Home/Shourya/professional/AutoNeural-Internal/AutoNeural-Internal/autoneural-hostinger-deployment.zip)** (Universal bundle)
- 📁 **[`autoneural-backend-deployment.zip`](file:///c:/Users/Home/Shourya/professional/AutoNeural-Internal/AutoNeural-Internal/autoneural-backend-deployment.zip)** (Dedicated NestJS Enterprise API bundle)

### What is Included in `autoneural-work-deployment.zip`:
1. **Fullstack Production App**: Complete Next.js standalone runner (`server.js`, `passenger.js`, `.htaccess`).
2. **All New Features Pre-compiled**:
   - **Document, Link & File Attachments**: Upload modal inside any task for PDFs, images, docs, and links.
   - **Submission & Approval Workflow**: Mark attachments as "For Approval" or "Output"; Admin Approve / Request Changes buttons with feedback notes.
   - **Dual-Admin Employee Removal**: Removal requires request by one admin and independent approval by the second admin.
   - **Team Member Provisioning**: Add employee dialog with manual company domain emails, designations, and roles.
   - **Admin Privileges**: `info@autoneural.in` is the master admin.
3. **No source code or database**: the ZIP contains only the compiled app. The NestJS API (`backend/`) is deployed separately. A database is included only when packaged with `--include-db`.
4. **Protected document root**: the generated `.htaccess` blocks web access to `data/`, `.env*`, SQLite files and server internals.

> [!IMPORTANT]
> **First deployment on an empty server**: there is no built-in admin password. Add `CRM_ADMIN_BOOTSTRAP_PASSWORD=<12+ characters>` to `.env.production`, restart, sign in as `info@autoneural.in` with it, choose a new password, then remove the variable. Uploaded task files are stored in `data/uploads` next to the database; back up both. Check `https://<subdomain>.autoneural.in/api/health` after each deploy.

---

### Steps to Deploy to `work.autoneural.in`:

1. **Verify Subdomain in Hostinger hPanel**:
   - Go to **Websites** → Select **autoneural.in** → **Domains** → **Subdomains**.
   - Ensure the subdomain **`work`** is active, pointing to:
     `domains/autoneural.in/public_html/work`
   - Under **Security** → **SSL**, verify SSL is active for `work.autoneural.in`.

2. **Upload & Extract ZIP**:
   - Go to **hPanel** → **File Manager**.
   - Navigate to: **`domains/autoneural.in/public_html/work/`**
   - Upload **`autoneural-work-deployment.zip`**.
   - Right-click the uploaded ZIP and click **Extract**.
   - > [!IMPORTANT]
   - > **Check the Destination Path**: Ensure the extraction destination is set to:
   - > `domains/autoneural.in/public_html/work/`
   - > Do **NOT** let File Manager extract into a nested folder like `domains/autoneural.in/public_html/work/autoneural-work-deployment/`.
   - > If files end up in a subfolder, select all files inside that subfolder and **Move** them to `domains/autoneural.in/public_html/work/`.

3. **Force LiteSpeed Passenger to Reload**:
   - LiteSpeed Passenger keeps old Node.js processes running in RAM until reloaded.
   - In File Manager under `domains/autoneural.in/public_html/work/tmp/`:
     - Open **`restart.txt`**, edit any character (or save it) to update its timestamp.
   - *(Optional)* In hPanel, under **Advanced** → **Node.js** (or Process Manager), click **Stop** then **Start** (or **Restart**).

4. **Verify All Features Live**:
   - Visit **`https://work.autoneural.in`** (use an Incognito tab to bypass browser caching).
   - Sign in with:
     - Master admin: `info@autoneural.in`
     - Employees: `shourya@autoneural.in`, `manyu@autoneural.in`, `rajashi@autoneural.in`, `warriorbiswas@autoneural.in`
   - Test the new features:
     - Open any task → Click **Attach document, file or link** → upload a file or submit for approval.
     - Go to **Team** tab → Click **+ Add team member** → enter manual domain email and designation.
     - In **Team** tab → Initiate dual-admin removal request for an employee.

---

### (Optional) Deploying the Standalone NestJS Backend (`autoneural-backend-deployment.zip`):
If you want to host the dedicated NestJS API with Swagger OpenAPI documentation on a separate subdomain (such as `https://api.autoneural.in`):
1. In hPanel → Subdomains, create `api` pointing to `domains/autoneural.in/public_html/api`.
2. Upload and extract **`autoneural-backend-deployment.zip`** directly into that directory.
3. Configure your production PostgreSQL `DATABASE_URL` in `.env.production`.
4. LiteSpeed Passenger will launch `dist/main.js` via `passenger.js`.
5. Swagger docs will be live at `https://api.autoneural.in/api/docs`.

---

## Method 1: Automated Deployment Script via SSH

### Step 1: Create the Subdomain in Hostinger hPanel

1. Log in to **[Hostinger hPanel](https://hpanel.hostinger.com/)**.
2. Navigate to **Websites** → Select **autoneural.in** → **Domains** → **Subdomains**.
3. In the **Create a Subdomain** form:
   - **Subdomain Name:** `crm` *(or your chosen subdomain name, e.g. `work`, `tasks`)*
   - **Custom folder for subdomain:** Check the box and set to:
     `domains/autoneural.in/public_html/crm`
   - Click **Create**.
4. Navigate to **Security** → **SSL**:
   - Ensure an SSL certificate (Let's Encrypt) is installed and active for `crm.autoneural.in`.

---

### Step 2: Ensure SSH Access is Enabled

1. In hPanel, go to **Advanced** → **SSH Access**.
2. Make sure SSH status is **Enabled**.
3. Note your connection details:
   - **SSH IP / Host:** `145.79.213.25`
   - **SSH Port:** `65002`
   - **Username:** `u294542559`
4. Add your public SSH key (`~/.ssh/id_ed25519_ainova.pub` or your default key) under **SSH Keys**.

---

### Step 3: Run the One-Click Deployment Script

From your local machine terminal:

```bash
# 1. Make the deployment script executable (if on Linux/macOS or Git Bash)
chmod +x deploy.sh scripts/deploy-hostinger.sh

# 2. Deploy to crm.autoneural.in (Default)
./deploy.sh crm

# OR if this is your FIRST deployment and you want to transfer your local accounts/database:
./deploy.sh crm --with-database
```

> [!TIP]
> You can deploy to any other subdomain under `autoneural.in` simply by changing the argument:
> ```bash
> ./deploy.sh work     # Deploys to https://work.autoneural.in
> ./deploy.sh tasks    # Deploys to https://tasks.autoneural.in
> ```

#### What the Deployment Script Automatically Does:
- Compiles the Next.js application with `NEXT_OUTPUT=standalone` and bundles static assets and dependencies.
- Injects `deploy/passenger.js` as the LiteSpeed Passenger entry point.
- Connects securely via SSH to Hostinger Cloud.
- Sets up directory structure (`~/autoneural-<subdomain>/releases`, `data/`, `logs/`, `backups/`).
- Writes `.env.production` with `CRM_APP_URL=https://<subdomain>.autoneural.in`.
- Configures `.htaccess` with Passenger rewrite rules and Node 24 runner.
- Gracefully restarts the LiteSpeed worker process via `deploy/activate.sh`.
- Runs a health check against `https://<subdomain>.autoneural.in/login`.

---

### Step 4: Schedule Daily Backups (hPanel Cron)

To ensure automatic daily snapshots of the database:
1. In hPanel, go to **Advanced** → **Cron Jobs**.
2. Set **Type:** `Custom`.
3. Set **Frequency:** Once per day (e.g., `0 2 * * *` at 2:00 AM).
4. Set **Command:**
   ```bash
   /bin/bash /home/u294542559/autoneural-crm/backup.sh autoneural-crm
   ```
5. Click **Save**. Daily database snapshots are stored in `~/autoneural-crm/backups/` (the last 30 are kept), together with an archive of uploaded files (`uploads-*.tar.gz`, the last 7 are kept).

---

## Method 2: Hostinger Cloud VPS Deployment (Docker & Caddy)

If you are using a Hostinger Cloud VPS (Ubuntu 22.04 / 24.04):

### Step 1: DNS Configuration
In Hostinger DNS Zone Editor for `autoneural.in`:
- Add an **A Record**:
  - **Name / Host:** `crm`
  - **Points to:** `<YOUR_HOSTINGER_VPS_IP>`
  - **TTL:** 300

### Step 2: Clone and Start Containers on the VPS

1. SSH into your Hostinger VPS:
   ```bash
   ssh root@<YOUR_HOSTINGER_VPS_IP>
   ```

2. Clone repository and set configuration:
   ```bash
   git clone <REPO_URL> /opt/autoneural
   cd /opt/autoneural
   cp .env.production.example .env.production
   ```

3. (Optional) Customize subdomain in `.env.production`:
   ```env
   APP_DOMAIN=crm.autoneural.in
   CRM_APP_URL=https://crm.autoneural.in
   ```

4. Launch the Docker stack:
   ```bash
   docker compose up -d --build
   ```

5. Caddy will automatically request and bind a free Let's Encrypt SSL certificate for `crm.autoneural.in`.
6. Open **`https://crm.autoneural.in`** in your browser.

---

## Environment Variables Reference

| Variable | Description | Example |
| :--- | :--- | :--- |
| `CRM_APP_URL` | Canonical URL of the web application | `https://work.autoneural.in` |
| `CRM_DATABASE_PATH` | Path to the SQLite database file | `data/autoneural-crm.sqlite` |
| `APP_DOMAIN` | Domain used by Caddy for SSL certificates | `work.autoneural.in` |
| `NODE_ENV` | Runtime environment | `production` |
| `SMTP_HOST` | Hostinger outgoing mail server | `smtp.hostinger.com` |
| `SMTP_PORT` | Hostinger SSL port | `465` |
| `SMTP_USER` | Full Hostinger email address | `info@autoneural.in` |
| `SMTP_PASS` | Password of Hostinger email account | `your_hostinger_password` |
| `SMTP_FROM_EMAIL` | Sender name and address | `AutoNeural Workspace <info@autoneural.in>` |

---

## Production Database Safety on Upgrades

> [!IMPORTANT]
> **Your Live Production Database Is Preserved Across Upgrades:**
> When packaging an update via `npm run package:work` or `npm run package:crm`, the packaging script **excludes** the local database file `data/autoneural-crm.sqlite` by default.
> 
> Therefore, extracting an update ZIP in Hostinger File Manager will **never overwrite** your live production database (`data/autoneural-crm.sqlite`), and all employees, tasks, attachments, and comments created in production remain completely intact.
> 
> **Optional Safety Tip**: Before extracting any new zip in Hostinger File Manager, you can right-click `data/autoneural-crm.sqlite` and download a quick backup copy to your computer.

---

## Rollback & Troubleshooting

### Rollback to a Previous Release (hPanel)
If an update needs to be rolled back immediately:
```bash
ssh -p 65002 -i ~/.ssh/id_ed25519_ainova u294542559@145.79.213.25
cd ~/autoneural-crm
# List previous release folders:
ls -dt app-*
# Symlink previous release:
ln -sfn app-<PREVIOUS_TIMESTAMP> current
# Signal restart:
touch current/tmp/restart.txt
```

### Inspecting Logs
- **Application Logs:** `~/autoneural-crm/logs/` or `docker compose logs -f app`
- **LiteSpeed Error Logs:** Accessible via hPanel → **Logs** → **Error Log**.
- **Backup Log:** `~/autoneural-crm/logs/backup.log`.

### Hostinger "Failed to build the application" Error:
If you are deploying via Hostinger hPanel's **Deployments** or **Node.js Web App** section instead of directly extracting in File Manager, Hostinger automatically triggers `npm install` followed by `npm run build`.
The updated deployment ZIPs (`autoneural-work-deployment.zip` and `autoneural-hostinger-deployment.zip`) now:
1. Include `src/` (so `src/app` exists for directory structure checks).
2. Set `"build"` in `package.json` to complete instantly (`node -e "console.log(...)"`) because standalone production output is already pre-compiled locally.
3. Set `"start"` to `node passenger.js` so Hostinger's start command launches the standalone server.

## Automatic leads

Leads land in **Leads** (sidebar) and each one becomes a High-priority "Call …" task for the next salesperson.
Connect sources as the admin under Leads → Automatic lead sources:

- **Website form / Zapier / Make / Meta Lead Ads** — create a key, then post to `https://work.autoneural.in/api/leads/intake`
  (Bearer key for tools; hidden `key` field for a plain HTML form — the page shows a ready-to-paste form).
- **Google Sheets / CSV** — paste a link shared as "Anyone with the link can view"; checked every 2 minutes.
- **IndiaMART** — paste the CRM API key from Lead Manager → CRM Integration; checked every 10 minutes.

The server pulls Sheets and IndiaMART every minute while it runs. Hostinger can idle-stop the app, so add a cron job
(hPanel → Advanced → Cron Jobs, every 5 minutes):

    curl -s https://work.autoneural.in/api/leads/intake > /dev/null

## AI calling agent (Riya)

`voice-agent/` holds the LiveKit worker from AUTONEURAL CRM, unchanged (`agent.py`, `voice_config.py`).
The workspace dispatches it from **AI Calls** or the **AI call** button on a lead; finished calls are posted to
`/api/agent/calls` and logged on the lead's task. Settings (same names as the CRM): `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `LLM_PROVIDER` + Gemini/Groq/OpenAI keys, `SARVAM_API_KEY`, `OUTBOUND_TRUNK_ID`,
`VOBIZ_OUTBOUND_NUMBER`, `VOBIZ_SIP_DOMAIN`, `DEFAULT_TRANSFER_NUMBER`, `AGENT_NAME`, `AGENT_INGEST_SECRET`,
and `CRM_URL` (this app's URL, where the agent posts calls).

Local: `python3.12 -m venv voice-agent/.venv && voice-agent/.venv/bin/pip install -r voice-agent/requirements.txt`,
then **AI Calls → Start agent**.

Hostinger shared hosting cannot run the Python worker. Run it on an always-on server (VPS) with the same settings and
`CRM_URL=https://work.autoneural.in`, and set `AGENT_EXTERNAL=true` on the web app. Only run ONE worker per `AGENT_NAME`:
LiveKit hands each call to any worker registered under that name.

## Sales & People modules (DigiSME parity)

Optional settings — each feature works without them and says what is missing:

| Setting | Enables |
| --- | --- |
| `GOOGLE_API_KEY` (+ `_2`), `AI_MODEL` | AI guidance, AI email drafts, "Ask your business" (Gemini; defaults to `gemini-3.5-flash`) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay payment links; webhook `…/api/payments/razorpay` (event `payment_link.paid`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe checkout links; webhook `…/api/payments/stripe` (event `checkout.session.completed`) |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Zoom meetings (Server-to-Server OAuth app). Without them meetings use a free video link. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` | WhatsApp template campaigns (Meta Cloud API) |

UPI QR codes on invoices need only the UPI ID under Quotes & Invoices → Company details.
Lead sources: Google Ads lead forms → webhook URL `…/api/leads/intake`, key = the intake key;
JustDial and similar push portals → `…/api/leads/intake?key=KEY` (GET or POST);
TradeIndia / ExportersIndia → paste their inquiry-API link as a "sheet" feed (JSON is detected).

## WhatsApp inbox, AI agent, automations, calling, usage (MVP gaps)

| Setting | Enables |
| --- | --- |
| `WHATSAPP_APP_SECRET` (**required** — the webhook rejects everything without it), `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Shared inbox. Meta → WhatsApp → Configuration → Webhook: `…/api/whatsapp/webhook`, field `messages`. |
| `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` (+ `EXOTEL_SUBDOMAIN`, default `api.in.exotel.com`) | "Call via company number" click-to-call with recording; status callback is set automatically. Each salesperson's mobile goes in People → Employees. |

AI WhatsApp agent: Inbox → ⚙ (admin) — write the approved knowledge, then enable. Automations: admin → Automations.
Rates and monthly AI/voice budgets: Admin → Usage. Everything sensitive is recorded under Admin → Audit.
