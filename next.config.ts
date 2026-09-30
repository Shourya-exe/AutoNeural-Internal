import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Everything the app loads is same-origin (fonts are bundled; QR codes and selfies are data: URLs).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["node:sqlite"],
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone" as const }
    : {}),
  async headers() {
    return [
      {
        // File downloads set their own policy (PDF viewers break under the page CSP).
        source: "/((?!api/attachments/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Attendance needs location; selfies and receipts use the file picker's camera, not getUserMedia.
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
          // Browsers ignore HSTS on plain-HTTP responses, so this is safe for local use too.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Pages and APIs carry private data; hashed static assets keep Next.js' immutable caching.
        source: "/((?!_next/static|_next/image|icon.svg|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async rewrites() {
    // Optional: expose the separate NestJS API (backend/) under /api/v1 on this domain.
    // Only enabled when NEST_BACKEND_URL is set; the workspace itself does not use it.
    const backendUrl = process.env.NEST_BACKEND_URL?.trim();
    if (!backendUrl) return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};
export default config;
