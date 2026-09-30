import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // crm/ lives inside a repo with other apps; pin tracing to this folder.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // Self-contained server bundle (.next/standalone) for hosts that can't run `npm install`
  // themselves (Hostinger Cloud's process limits). Local `next dev` is unaffected.
  output: "standalone",
  // Prisma loads its query engine binary dynamically, so file tracing can't see it.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**/*", "./node_modules/@prisma/client/**/*"],
  },
  poweredByHeader: false,
  experimental: {
    // Keep server actions body limit generous for CSV import.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  eslint: {
    // Lint is run explicitly in CI; do not block production builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
