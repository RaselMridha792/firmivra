import { randomBytes } from 'node:crypto';
import type { Area } from './hosts';

/**
 * The Content-Security-Policy, REPORT-ONLY for now (prod readiness item 11, Nov 18): browsers
 * report what it would block in their console and block nothing. The live sweep reads those
 * console lines. Enforcing it later is the header name below, after a clean sweep.
 *
 * The proxy sends it on every page with a fresh nonce. Next.js stamps that nonce on its own
 * scripts where a page is rendered per request. Our one inline script, the V8 early calls in the
 * firm workspace layout, is allowed by its hash, so it is allowed whether or not its page is
 * prerendered (csp.test.ts keeps the hash in step with the script).
 *
 * Only what the sites load: our own host (pages, /api/v1 and next/font's self-hosted fonts), the
 * S3 hosts the API signs document links for, and blob: and data: for previews, downloads and the
 * PDF worker. No third-party script: payments go to Stripe by redirect, not Stripe.js.
 *
 * Not in a report-only policy, because browsers ignore them there and log a warning on every
 * page: frame-ancestors (to add with enforcement: 'none' on admin and firm; never on the portal,
 * whose booking and intake pages firms embed on their own sites) and upgrade-insecure-requests.
 */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

/** sha256 (base64) of the V8 early-calls script, pageCallsScript(pageCallUrls()). */
export const EARLY_CALLS_SHA256 = 'OeeVhJcacTMYeZWGrZ0RynYU0CnPrw/h2lqj+bpue0k=';

/** The S3 hosts of signed document links (virtual-hosted style, us-east-1). */
const DOCUMENT_SOURCES = ['https://*.s3.amazonaws.com', 'https://*.s3.us-east-1.amazonaws.com'];

/** A fresh nonce for one response (128 random bits). */
export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

/** Extra document sources from CSP_DOCUMENT_SOURCES (space or comma separated), if a deploy needs them. */
export function documentSources(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env['CSP_DOCUMENT_SOURCES'] ?? '').split(/[\s,]+/).filter(Boolean);
  return [...DOCUMENT_SOURCES, ...extra];
}

export interface CspOptions {
  nonce: string;
  area: Area | null;
  /** Development: React's eval for error stacks, the dev server's websocket, local s3mock. */
  dev: boolean;
  documents?: string[];
}

/** The policy for one response, as a header value. */
export function buildCsp({ nonce, dev, documents = documentSources() }: CspOptions): string {
  const docs = [...documents, ...(dev ? ['http://localhost:*'] : [])].join(' ');
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      `'self' 'nonce-${nonce}' 'sha256-${EARLY_CALLS_SHA256}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    ],
    // React style attributes and Next.js's style tags; a nonce can't cover style attributes.
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', `'self' data: blob: ${docs}`],
    ['font-src', "'self' data:"],
    ['connect-src', `'self' ${docs}${dev ? ' ws:' : ''}`],
    ['media-src', `'self' blob: ${docs}`],
    ['frame-src', `'self' blob: ${docs}`],
    ['worker-src', "'self' blob:"],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}
