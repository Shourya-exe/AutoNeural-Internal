"""Voice-call WhatsApp bridge. The CRM owns provider rules, deduplication and the inbox."""
from __future__ import annotations
import os
import ssl
import aiohttp
import certifi

_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

async def send_call_message(*, phone: str, message: str, request_id: str, confirmed: bool,
                            organization_id: str | None = None, lead_id: str | None = None,
                            name: str | None = None) -> dict:
    if not confirmed:
        return {"accepted": False, "error": "Ask permission and confirm the recipient before sending."}
    secret = os.getenv("AGENT_INGEST_SECRET", "")
    organization_id = organization_id or os.getenv("AGENT_DEFAULT_ORG_ID")
    if not secret or not organization_id:
        return {"accepted": False, "error": "CRM WhatsApp bridge is not configured. Nothing was sent."}
    base = (os.getenv("CRM_URL") or os.getenv("APP_URL") or "http://localhost:3000").rstrip("/")
    payload = {"organizationId": organization_id, "leadId": lead_id, "phone": phone,
               "message": message, "requestId": request_id, "confirmed": True}
    if name:
        payload["name"] = name
    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=_SSL_CONTEXT),
                                         timeout=aiohttp.ClientTimeout(total=18)) as http:
            async with http.post(f"{base}/api/agent/whatsapp", json=payload,
                                 headers={"Authorization": f"Bearer {secret}"}) as response:
                data = await response.json()
                if response.status != 200:
                    return {"accepted": False, "error": data.get("error", "CRM could not send the message.")}
                return data
    except Exception:
        # A timeout can happen after provider acceptance. Never automatically resend.
        return {"accepted": False, "status": "UNKNOWN", "error": "Message status could not be confirmed. Check the CRM inbox before retrying."}
