import type { NextConfig } from 'next';

/**
 * Contractors Guild - Next.js configuration.
 *
 * Notes:
 * - `serverExternalPackages` keeps `pg` out of the bundler so the Postgres
 *   driver runs as a real Node module on the server.
 * - `allowedDevOrigins` permits the sandbox/preview hostnames used while
 *   developing. It has no effect in production builds.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev', 'localhost:3000', '127.0.0.1:3000'],
  experimental: {
    // Server Actions receive validated payloads from our own forms only.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
