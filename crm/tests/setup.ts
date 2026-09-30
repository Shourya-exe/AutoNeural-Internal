/**
 * Per-worker test setup. Runs BEFORE any module under test is imported, so the
 * environment (DATABASE_URL pointing at the test database, DEMO_MODE off) is in
 * place when lib/env.ts and lib/prisma.ts are first evaluated.
 */
try {
  (process as any).loadEnvFile?.();
} catch {
  /* ignore */
}

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("_test")) {
  const u = new URL(process.env.DATABASE_URL);
  const db = u.pathname.replace(/^\//, "").split("?")[0];
  u.pathname = `/${db}_test`;
  process.env.DATABASE_URL = u.toString();
}

// The Prisma *client* only reads `url`, but keep `directUrl` consistent so any
// CLI invocation from within a test can never touch the real database.
process.env.DIRECT_URL = process.env.DATABASE_URL;

// Deterministic, credential-free test environment.
process.env.DEMO_MODE = "false";
process.env.REDIS_URL = ""; // force inline processing, no external queue
process.env.INTEGRATION_ENCRYPTION_KEY =
  process.env.INTEGRATION_ENCRYPTION_KEY ?? "dGVzdC1rZXktZm9yLXZpdGVzdC0zMi1ieXRlcy0hIQ==";
process.env.WHATSAPP_APP_SECRET = "test-whatsapp-secret";
// Existing WhatsApp tests exercise the Meta adapter; the Twilio adapter has its own tests.
process.env.WHATSAPP_PROVIDER = "meta";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-auth-token";
process.env.APP_URL = "https://demo.autoneural.in";
process.env.WHATSAPP_VERIFY_TOKEN = "test-whatsapp-verify";
process.env.META_LEADADS_APP_SECRET = "test-leadads-secret";
process.env.MESSENGER_APP_SECRET = "test-messenger-secret";
process.env.INSTAGRAM_APP_SECRET = "test-instagram-secret";
