# Autoneural CRM handover

Company: Autoneural. Administrator: PALASH, info@autoneural.in.
Company Jio / WhatsApp number: +916297927642.
WhatsApp contact link: https://wa.me/916297927642.

## Completed locally

- Production mode and authentication enabled; demo event injection disabled. The legacy `/api/webhooks/whatsapp/ai` callback now uses signed, deduplicated inbox ingestion; its unsafe automatic sending behaviour was removed.
- Local Redis was unavailable, so this workspace uses inline webhook processing plus the background sweep worker. Configure Redis on the hosting server if you want durable queued processing.
- Removed 46 seeded leads, one simulated prospect, 12 synthetic calls, 10 properties and five demo staff accounts. Kept two manually created dialer leads and six actual dialer call records.
- A complete database JSON snapshot is in the private `.deploy` directory. No external database was changed.
- Autoneural branding, general business service catalog, sales pipeline and truthful AI prompts replace real estate content. Property routes are retired.
- Login credentials are in `.deploy/autoneural-admin-login.txt` (owner-readable). Change the password in Settings → Profile.
- The existing LiveKit inbound trunk for +918065354081 was renamed Autoneural inbound, and its dispatch rule now selects `autoneural-crm-assistant`. Previous configuration is backed up in `.deploy/inbound-route-before.json`.

## Finish phone activation

1. Verify with Vobiz that +918065354081 accepts inbound PSTN calls and sends them to the existing LiveKit inbound trunk. A dispatch rule alone does not verify provider delivery.
2. On the Jio company SIM, use MyJio / supported call settings to enable **Call Forwarding No Answer** to **8065354081**. Ask Jio support if conditional forwarding is unavailable in the phone UI. Do not select unconditional forwarding if the handset should ring first.
3. Keep the CRM, PostgreSQL, background worker and Python voice worker running on an always-on host. The local Mac must remain awake during local tests. Existing PM2 configuration is available for hosting; this task has not deployed the app.
4. Call +916297927642 from another phone: answer normally and verify AI does not join. Repeat without answering, confirm Autoneural AI answers, then verify the caller and transcript in Call Logs. Also test an unavailable agent and confirm a usable fallback with the provider.
5. A separate human transfer destination can be configured with `DEFAULT_TRANSFER_NUMBER`. Never set it to the forwarded company number; this creates a loop.

This path handles normal cellular phone calls, not WhatsApp voice calls.

References: https://www.jio.com/help/faq/mobile/services/hd-voice/what-are-different-types-of-call-forwarding/ and https://docs.livekit.io/telephony/accepting-calls/dispatch-rule/.

## Finish WhatsApp API activation

The previous Meta API credentials resolved to **+1 555-201-4253, Test Number**. The test phone number ID has been disconnected. Your WhatsApp app registration does not by itself connect WhatsApp messaging to the CRM.

Register/authorize +916297927642 with Meta WhatsApp Business Platform (using the supported onboarding path for your current account). Set its real `WHATSAPP_PHONE_NUMBER_ID`, an appropriate access token, `WHATSAPP_APP_SECRET` and verify token. Configure a public HTTPS webhook at `/api/webhooks/whatsapp`. The app secret is currently missing. Verify a real incoming and outgoing message before marking it connected. Old property messaging templates were cleared.

## Run

```sh
npm run db:local
npm run build
npm start
npm run worker:start
.venv-agent/bin/python agent.py start
```

Use separate terminals for long-running processes. For a fresh database, run migrations, then `npm run db:bootstrap`; `npm run db:seed` now creates only production structure, never fake business records. Do not run database reset on an existing company database.
