import type { NextConfig } from 'next';

// web/ sits inside the repo next to the older internal app; pin the root so Next doesn't pick up the parent lockfile.
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;
