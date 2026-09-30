import { dirname, join, resolve } from "node:path";

/**
 * Server-side configuration. Read environment variables through here so defaults,
 * derived paths and production checks live in one place. Never import from client code.
 */

export const isProduction = () => process.env.NODE_ENV === "production";

/** SQLite database file. Use an absolute path on a persistent disk in production. */
export function databasePath() {
  return resolve(/* turbopackIgnore: true */ process.env.CRM_DATABASE_PATH || "data/autoneural-crm.sqlite");
}

/** Uploaded task files. Defaults to an `uploads` folder next to the database so both share one backup. */
export function uploadDir() {
  const configured = process.env.CRM_UPLOAD_DIR?.trim();
  return resolve(/* turbopackIgnore: true */ configured || join(dirname(databasePath()), "uploads"));
}

/** Largest accepted upload, in bytes (CRM_MAX_UPLOAD_MB, default 25 MB). */
export function maxUploadBytes() {
  const mb = Number(process.env.CRM_MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? Math.min(mb, 200) : 25) * 1024 * 1024;
}

/** Public origin of the workspace, e.g. https://work.autoneural.in (no trailing slash). */
export function configuredAppUrl() {
  const raw = process.env.CRM_APP_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Extra origins allowed to make state-changing requests (comma separated, exact origins). */
export function allowedOrigins() {
  return (process.env.CRM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [new URL(s).origin];
      } catch {
        return [];
      }
    });
}

/**
 * Configuration problems worth surfacing at startup and on the health check.
 * `errors` make the deployment unsafe or broken; `warnings` disable optional features.
 */
export function configReport() {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (isProduction()) {
    const url = configuredAppUrl();
    if (!url) errors.push("CRM_APP_URL is not set to a valid URL (e.g. https://work.autoneural.in).");
    else if (!url.startsWith("https://")) warnings.push("CRM_APP_URL is not HTTPS, so session cookies are not marked Secure.");
    if (!process.env.CRM_DATABASE_PATH) warnings.push("CRM_DATABASE_PATH is not set; using data/autoneural-crm.sqlite relative to the working directory.");
  }
  const secret = process.env.AGENT_INGEST_SECRET ?? "";
  if (secret && secret.length < 24) warnings.push("AGENT_INGEST_SECRET is shorter than 24 characters.");
  const inbound = process.env.MAIL_INBOUND_SECRET ?? "";
  if (inbound && inbound.length < 24) warnings.push("MAIL_INBOUND_SECRET is shorter than 24 characters.");
  return { errors, warnings };
}
