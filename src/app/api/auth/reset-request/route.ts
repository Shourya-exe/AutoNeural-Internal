import { body, clientContext, failure, sameOrigin } from "@/lib/http";
import { requestPasswordReset } from "@/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Forgot password" from the sign-in page. Always the same answer; an admin must approve. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { email } = (await body(req)) as { email?: unknown };
    return Response.json(requestPasswordReset(email, clientContext(req)));
  } catch (e) {
    return failure(e);
  }
}
