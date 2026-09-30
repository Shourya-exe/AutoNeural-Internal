"""Send one explicitly confirmed test through the same CRM path as the voice agent."""
import argparse
import asyncio
import uuid
from dotenv import load_dotenv
from whatsapp_sender import send_call_message

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phone")
    parser.add_argument("message")
    parser.add_argument("--confirm", action="store_true", help="Confirm permission to send to this recipient")
    args = parser.parse_args()
    if not args.confirm:
        parser.error("Use --confirm only after confirming recipient permission")
    load_dotenv()
    result = await send_call_message(phone=args.phone, message=args.message,
                                     request_id=f"manual-test:{uuid.uuid4()}", confirmed=True)
    print(result)
    if not result.get("accepted"):
        raise SystemExit(1)

if __name__ == "__main__":
    asyncio.run(main())
