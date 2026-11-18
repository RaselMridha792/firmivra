import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { CSP_HEADER } from './lib/csp';
import { proxy } from './proxy';

// The CSP (report-only) on every page the proxy serves: a fresh nonce on the request (Next.js
// stamps it on its scripts) and the same policy on the response. Nothing enforces it.
// The proxy picks the site from the Host header, as behind CloudFront.
const get = (url: string) => proxy(new NextRequest(url, { headers: { host: new URL(url).host } }));

describe('proxy: Content-Security-Policy-Report-Only', () => {
  it('puts the policy with a nonce on a page of each site, and never an enforcing header', () => {
    for (const url of [
      'http://app.localhost/clients',
      'http://admin.localhost/',
      'http://portal.localhost/lvp/home',
    ]) {
      const res = get(url);
      const policy = res.headers.get(CSP_HEADER);
      expect(policy, url).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}'/);
      expect(res.headers.get('content-security-policy'), url).toBeNull();
      // The request Next.js renders carries the same policy and nonce.
      const forwarded = res.headers.get('x-middleware-request-content-security-policy-report-only');
      expect(forwarded, url).toBe(policy);
      const nonce = res.headers.get('x-middleware-request-x-nonce');
      expect(policy, url).toContain(`'nonce-${nonce}'`);
    }
  });

  it('makes a new nonce for every request', () => {
    const a = get('http://app.localhost/').headers.get('x-middleware-request-x-nonce');
    const b = get('http://app.localhost/').headers.get('x-middleware-request-x-nonce');
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('leaves the 404s as they were', () => {
    const res = get('http://portal.localhost/%2Fevil.com/home');
    expect(res.status).toBe(404);
    expect(res.headers.get(CSP_HEADER)).toBeNull();
  });
});
