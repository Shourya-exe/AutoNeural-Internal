/**
 * Loads `.env` for standalone (non-Next) processes.
 *
 * This must be the FIRST import in the worker entrypoint: ES module imports are
 * hoisted, so a `process.loadEnvFile()` call written inline in index.ts would
 * run AFTER lib/env.ts had already been evaluated. Importing this module first
 * guarantees the correct order.
 */
try {
  (process as any).loadEnvFile?.(); // Node 20.12+ / 22+
} catch {
  // No .env file — fall back to the ambient environment (containers, PM2, CI).
}

export {};
