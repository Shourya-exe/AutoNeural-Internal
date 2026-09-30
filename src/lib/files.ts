import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { maxUploadBytes, uploadDir } from "./config";
import { AppError } from "./errors";
import { ATTACHMENT_TYPES } from "./types";

/**
 * Task file storage on the server's disk (CRM_UPLOAD_DIR). Files are stored under random
 * names outside the web root and are only ever served through an access-checked route.
 * The content type comes from an allow-list keyed by extension, never from the client.
 */

const TYPES = ATTACHMENT_TYPES;

/** Types a browser may display inline; each is checked against its file signature. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

export const acceptedExtensions = Object.keys(TYPES);

export type StoredFile = { key: string; name: string; mime: string; size: number; sha256: string };

const KEY = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;
const pathFor = (key: string) => {
  if (!KEY.test(key)) throw new AppError(404, "File not found.");
  return join(uploadDir(), ...key.split("/"));
};

/** A display name without path parts or control characters. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim().slice(0, 180);
  return clean || "file";
}

export async function saveUpload(file: File): Promise<StoredFile> {
  if (!file.size) throw new AppError(400, "The selected file is empty.");
  const limit = maxUploadBytes();
  if (file.size > limit) throw new AppError(413, `Files can be up to ${Math.round(limit / 1024 / 1024)} MB.`);
  const name = safeFileName(file.name);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const mime = TYPES[ext];
  if (!mime) throw new AppError(415, `This file type is not supported. Allowed: ${acceptedExtensions.join(", ")}.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const signature = SIGNATURES[mime];
  if (signature && !signature(bytes)) throw new AppError(415, "The file's contents do not match its extension.");
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const path = pathFor(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  return { key, name, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Streams a stored file; throws 404 when the file is missing on disk. */
export function readStoredFile(key: string) {
  const path = pathFor(key);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new AppError(404, "This file is no longer available on the server.");
  }
  return { size, body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array> };
}

/** Best-effort delete; a missing file is not an error. */
export function removeStoredFile(key: string | null | undefined) {
  if (!key) return;
  try {
    rmSync(pathFor(key), { force: true });
  } catch (e) {
    console.error("[files] could not delete", key, e);
  }
}

/** Response headers that stop an uploaded file from running as a page in our origin. */
export function downloadHeaders(file: { name: string; mime: string; size: number }, inline: boolean) {
  const disposition = inline && SIGNATURES[file.mime] ? "inline" : "attachment";
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "content-type": file.mime,
    "content-length": String(file.size),
    "content-disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
    // Browsers' PDF viewers refuse to run in a sandboxed document; PDFs never get script access to our origin anyway.
    ...(file.mime === "application/pdf" ? {} : { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    "cache-control": "private, no-store",
  };
}
