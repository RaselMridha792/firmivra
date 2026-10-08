import { isIPv4, isIPv6 } from 'node:net';

/**
 * One form per address: IPv4 without the IPv4-mapped prefix (::ffff:), IPv6 with all eight groups
 * written out in lower case (no zone). Anything else is 'unknown', one shared bucket, so a missing
 * or odd IP never skips the limits.
 */
export function canonicalIp(ip: string | undefined): string {
  const raw = (ip ?? '').trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  const v4 = mapped ? mapped[1]! : raw;
  if (isIPv4(v4)) return v4;
  if (!isIPv6(raw)) return 'unknown';
  let groups = raw.toLowerCase();
  // An IPv4 tail (64:ff9b::1.2.3.4) as two groups.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(groups);
  if (tail) {
    const [a, b, c, d] = tail[1]!.split('.').map(Number) as [number, number, number, number];
    groups = `${groups.slice(0, -tail[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = groups.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const middle = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...middle, ...right].map((g) => g.padStart(4, '0')).join(':');
}

/** The /24 (IPv4) or /48 (IPv6) network of an IP, from its canonical form. */
export function networkOf(ip: string | undefined): string {
  const canonical = canonicalIp(ip);
  if (canonical === 'unknown') return canonical;
  if (isIPv4(canonical)) return `${canonical.split('.').slice(0, 3).join('.')}.0/24`;
  return `${canonical.split(':').slice(0, 3).join(':')}::/48`;
}
