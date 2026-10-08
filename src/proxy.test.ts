import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSP_NONCE_HEADER, cspHeader, proxy } from './proxy';

describe('proxy CSP', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets a Content-Security-Policy header with a nonce per response', () => {
    const request = new NextRequest('http://localhost/', {
      headers: { accept: 'text/html' },
    });

    const response = proxy(request);
    const csp = response.headers.get('Content-Security-Policy');

    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/script-src 'self' 'nonce-[a-f0-9]{32}'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });

  it('never allows inline scripts or inline <style> blocks', () => {
    const request = new NextRequest('http://localhost/');
    const csp = proxy(request).headers.get('Content-Security-Policy') ?? '';

    const scriptSrc = csp.match(/script-src [^;]+/)?.[0] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    const styleSrc = csp.match(/style-src [^;]+/)?.[0] ?? '';
    expect(styleSrc).not.toContain("'unsafe-inline'");
    // Style *attributes* stay allowed for the design-system swatches; the
    // unrestricted inline policy is gone.
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it('forwards the very same nonce to the page for the markup', () => {
    const next = vi.spyOn(NextResponse, 'next');
    const request = new NextRequest('http://localhost/');

    const response = proxy(request);

    // The nonce handed to the page must be the one in the policy, or the
    // theme bootstrap script is blocked by its own header.
    const forwarded = next.mock.calls[0]?.[0]?.request?.headers?.get(CSP_NONCE_HEADER);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    const headerNonce = csp.match(/nonce-([a-f0-9]+)/)?.[1];

    expect(forwarded).toBe(headerNonce);
    expect(forwarded).toBeTruthy();
    next.mockRestore();

    // The nonce must be fresh per request, or its value is meaningless.
    const second = proxy(new NextRequest('http://localhost/'));
    const secondCsp = second.headers.get('Content-Security-Policy') ?? '';
    expect(secondCsp.match(/nonce-([a-f0-9]+)/)?.[1]).not.toBe(headerNonce);
  });

  it('builds a deterministic header from a given nonce', () => {
    expect(cspHeader('abc')).toContain("script-src 'self' 'nonce-abc'");
    expect(cspHeader('abc')).toContain("style-src 'self' 'nonce-abc'");
  });
});
