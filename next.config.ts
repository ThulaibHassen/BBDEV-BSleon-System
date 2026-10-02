import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // the original apps were noindex; keep every page out of search engines
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const nextConfig: NextConfig = {
  output: 'standalone', // small self-contained server for the Docker image / Railway
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'ioredis', 'web-push'],
  experimental: {
    serverActions: { bodySizeLimit: '45mb' },
    // route handlers read uploads through request.formData(); allow large PDFs past the proxy
    proxyClientMaxBodySize: '45mb',
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // service workers must be re-checked on every open, or phones keep an old build
      { source: '/:app(student|parent|staff)/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/brand/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
    ];
  },
};

export default nextConfig;
