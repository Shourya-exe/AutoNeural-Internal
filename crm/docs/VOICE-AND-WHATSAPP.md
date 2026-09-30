# Voice and WhatsApp configuration

The assistant uses Deepgram Nova-3 multilingual for English/Hindi/Hinglish and explicitly switches to `bn` for Bengali. It uses telephony background voice cancellation where installed, formatted numerals, company vocabulary hints, 400 ms STT endpointing, and a 700 ms minimum turn delay. These changes allow more natural pauses; tune them against real Jio calls rather than assuming a measured accuracy increase. Bengali is not part of Nova-3's ten-language `multi` group.

Gemini 3.5 Flash is now first in the model chain, with low reasoning effort and lower temperature. The lighter model and other configured providers remain fallbacks. Prompts require clarification of uncertain names/numbers, remembering corrections, business qualification, truthful pricing and callback statements, and short answers. Summaries now capture company requirements and support issues instead of property needs.

## Send WhatsApp during a call

The caller asks for a message → assistant confirms recipient and contents → `send_whatsapp_message` → authenticated CRM endpoint → Meta or Twilio → message stored in Inbox with actual provider status. Duplicate requests are not sent again. A timeout is UNKNOWN, not success. Provider acceptance is SENT, never presumed DELIVERED. A maximum of three distinct message attempts is allowed per call.

The company number **+916297927642 still needs its real WhatsApp Business API connection**. No test-number credentials have been restored. Set the provider credentials documented in the existing handover and verify the number with Meta/Twilio. Inbound webhooks must be configured so delivery updates and the 24-hour customer-service window work.

A cellular call does not open a WhatsApp messaging window. For a first message, obtain approval for this **exact body** template, with two body parameters and no media header:

> Hi {{1}}, this is Autoneural following up on your call. {{2}} Reply here if you need help.

Set `VOICE_WHATSAPP_TEMPLATE_NAME` and `VOICE_WHATSAPP_TEMPLATE_LANGUAGE` for Meta, or `VOICE_WHATSAPP_CONTENT_SID` for Twilio. The template body is also the text stored in the inbox. If using different wording or language, update the service's stored body to match before use.

Without a template the agent can send free-form text only after the customer has messaged the company on WhatsApp within the past 24 hours. It explains the limitation instead of pretending to send.

The voice agent and CRM share `AGENT_INGEST_SECRET`. The worker uses `CRM_URL` or `APP_URL` and `AGENT_DEFAULT_ORG_ID`. Preserve these on the always-on deployment. Restart the web server and voice worker after configuration changes.

## Verify

- Run `npm test` for provider acceptance/rejection, templates, expiry, consent and duplicate prevention; provider calls are mocked and test records stay in the test database.
- Run `python3 -m py_compile agent.py voice_config.py whatsapp_sender.py`.
- Test live English/Hinglish/Bengali calls with pauses, background noise, digit sequences and corrections. Compare transcripts to what was actually said.
- After connecting the business API, request a follow-up on your own test call, verify Inbox and receipt on the phone. Repeat the same request and verify it is not duplicated.

References: [Deepgram languages](https://developers.deepgram.com/docs/models-languages-overview), [LiveKit turn tuning](https://docs.livekit.io/agents/logic/turns/tuning/), [WhatsApp messaging windows](https://www.twilio.com/docs/whatsapp/key-concepts).
