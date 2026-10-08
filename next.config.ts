import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Headers here are a floor, not a substitute for a real security review.
 *
 * careOS handles identifiable patient information, so the defaults matter: a
 * Referrer-Policy of `no-referrer` stops a leaked facility URL from reaching a
 * third party, and the framing and MIME-sniffing locks close off the cheap
 * clickjacking and content-injection paths.
 *
 * `Content-Security-Policy` is asserted in the proxy, not here: it carries a
 * per-request nonce, so it cannot be a static header. See src/proxy.ts and
 * docs/decisions.md ADR-010.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    // Camera and microphone are off: nothing in a hospital management system
    // needs them, and an unexpected prompt erodes trust in a clinical tool.
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Brief requirement: a self-contained server bundle for container deployment,
  // so the runtime image does not need the full node_modules tree.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [];
  },
};

export default withNextIntl(nextConfig);
