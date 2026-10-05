import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Headers here are a floor, not a substitute for a real security review.
 *
 * careOS handles identifiable patient information, so the defaults matter: a
 * Referrer-Policy of `no-referrer` stops a leaked facility URL from reaching a
 * third party, and the framing and MIME-sniffing locks close off the cheap
 * clickjacking and content-injection paths.
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
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Tailwind and the font CSS ship as same-origin stylesheets; no inline
      // style allowance is needed for the token system.
      "style-src 'self' 'unsafe-inline'",
      // The theme bootstrap script is inlined, which is why this cannot be
      // tightened to script-src 'self' without a nonce. Tracked in
      // docs/limitations.md as F0 debt to close with a per-request nonce.
      "script-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
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
