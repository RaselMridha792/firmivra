import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';

// An outbound POST to an address a firm typed (a custom webhook). The address is the firm's, so it
// is untrusted: https only, no credentials in the URL, and the connection may reach public
// addresses only. The check is made on the address the connection actually uses (a custom DNS
// lookup), so a name that resolves to a private address, or changes between the check and the
// connection, is refused. A short timeout and a cap on the body read keep a slow or huge answer
// from holding the request.

export interface OutboundResult {
  status: number | null;
  durationMs: number;
  /** A short safe reason when it did not complete: `blocked`, `timeout`, `unreachable`. */
  failure: 'blocked' | 'timeout' | 'unreachable' | null;
}

export interface OutboundHttp {
  post(url: string, headers: Record<string, string>, body: string): Promise<OutboundResult>;
}

/** Nest token for the outbound HTTP client (tests replace it). */
export const OUTBOUND_HTTP = Symbol('OUTBOUND_HTTP');

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 64 * 1024;

/** True for an address a webhook must never reach: private, loopback, link-local, metadata, reserved. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('::ffff:')) return isBlockedAddress(a.slice(7));
    return (
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      a.startsWith('fe8') ||
      a.startsWith('fe9') ||
      a.startsWith('fea') ||
      a.startsWith('feb') ||
      a.startsWith('ff')
    );
  }
  return true;
}

/** The URL is https, has no user information and no literal blocked address. */
export function checkWebhookUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host)) return null;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  )
    return null;
  return url;
}

export class SafeOutboundHttp implements OutboundHttp {
  post(rawUrl: string, headers: Record<string, string>, body: string): Promise<OutboundResult> {
    const started = Date.now();
    const done = (status: number | null, failure: OutboundResult['failure']): OutboundResult => ({
      status,
      durationMs: Date.now() - started,
      failure,
    });
    const url = checkWebhookUrl(rawUrl);
    if (!url) return Promise.resolve(done(null, 'blocked'));
    return new Promise((resolve) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body)),
          },
          timeout: TIMEOUT_MS,
          // Checked on the address the socket really uses.
          lookup: (hostname, options, callback) => {
            dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
              if (error) return callback(error, '', 4);
              const list = addresses as { address: string; family: number }[];
              const blocked = list.some((a) => isBlockedAddress(a.address));
              if (blocked || list.length === 0) return callback(new Error('blocked'), '', 4);
              const first = list[0]!;
              if ((options as { all?: boolean }).all) {
                return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
              }
              return callback(null, first.address, first.family);
            });
          },
        },
        (res) => {
          let read = 0;
          res.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read > MAX_BYTES) res.destroy();
          });
          res.on('end', () => resolve(done(res.statusCode ?? null, null)));
          res.on('error', () => resolve(done(res.statusCode ?? null, null)));
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(done(null, 'timeout'));
      });
      req.on('error', (error) =>
        resolve(done(null, error.message === 'blocked' ? 'blocked' : 'unreachable')),
      );
      req.write(body);
      req.end();
    });
  }
}
