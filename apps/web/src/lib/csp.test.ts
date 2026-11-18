import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { pageCallUrls } from '../app/firm/(workspace)/_components/dashboard-calls';
import { buildCsp, CSP_HEADER, documentSources, EARLY_CALLS_SHA256, newNonce } from './csp';
import { pageCallsScript } from './early';

// dashboard-calls imports the browser API client; only its URL builder is used here (hoisted).
vi.mock('./api', () => ({ api: {} }));

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe('Content-Security-Policy (report-only)', () => {
  it('is report-only: browsers report, block nothing', () => {
    expect(CSP_HEADER).toBe('Content-Security-Policy-Report-Only');
  });

  it('allows the V8 early-calls script by its hash; update EARLY_CALLS_SHA256 when the script changes', () => {
    const hash = createHash('sha256').update(pageCallsScript(pageCallUrls())).digest('base64');
    expect(EARLY_CALLS_SHA256).toBe(hash);
    expect(directive(buildCsp({ nonce: 'n', area: 'firm', dev: false }), 'script-src')).toContain(
      `'sha256-${hash}'`,
    );
  });

  it('gives scripts the nonce and strict-dynamic, and no eval outside development', () => {
    const nonce = newNonce();
    const prod = directive(buildCsp({ nonce, area: 'firm', dev: false }), 'script-src');
    expect(prod).toContain(`'nonce-${nonce}'`);
    expect(prod).toContain("'strict-dynamic'");
    expect(prod).not.toContain('unsafe-eval');
    expect(prod).not.toContain('unsafe-inline');
    expect(directive(buildCsp({ nonce, area: 'firm', dev: true }), 'script-src')).toContain(
      "'unsafe-eval'",
    );
  });

  it('makes a new nonce for every response', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const n of nonces) expect(Buffer.from(n, 'base64')).toHaveLength(16);
  });

  it('allows only our host, the S3 document hosts, blob: and data:', () => {
    const policy = buildCsp({ nonce: 'n', area: 'portal', dev: false });
    expect(directive(policy, 'default-src')).toBe("'self'");
    expect(directive(policy, 'connect-src')).toBe(
      "'self' https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com",
    );
    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'base-uri')).toBe("'self'");
    expect(directive(policy, 'form-action')).toBe("'self'");
    expect(policy).not.toMatch(/stripe|googleapis|gstatic|\*\s|'unsafe-eval'/);
    // Ignored (with a console warning on every page) in a report-only policy.
    expect(policy).not.toContain('frame-ancestors');
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('takes extra document hosts from CSP_DOCUMENT_SOURCES', () => {
    expect(
      documentSources({ CSP_DOCUMENT_SOURCES: 'https://docs.example.test, https://b.test' }),
    ).toEqual([
      'https://*.s3.amazonaws.com',
      'https://*.s3.us-east-1.amazonaws.com',
      'https://docs.example.test',
      'https://b.test',
    ]);
  });
});
