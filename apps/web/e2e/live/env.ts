import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything the live checks need from outside the repo. Credentials come only from environment
 * variables set by the runner; never print them, put them in a test title, or attach them.
 */
export type Role =
  | 'owner'
  | 'admin'
  | 'staff'
  | 'client'
  // Appointments P10 (lead, Nov 19): one harness login per other built-in role, and two custom roles.
  | 'manager'
  | 'bookkeeper'
  | 'preparer'
  | 'support'
  | 'consultant'
  | 'readonly'
  | 'custom1'
  | 'custom2'
  // Appointments 8, P7, P8 (lead, Nov 19): the inbox client's portal login (a real test inbox).
  | 'inbox';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

export const appUrl = process.env['LIVE_APP_URL'] ?? 'https://app.dev.firmivra.com';
export const portalUrl = process.env['LIVE_PORTAL_URL'] ?? 'https://portal.dev.firmivra.com';
export const firmSlug = process.env['LIVE_FIRM_SLUG'] ?? 'test-firm-b';
export const portal = (path = '') => `${portalUrl}/${firmSlug}${path}`;
export const app = (path = '') => `${appUrl}${path}`;

/** Guard: the harness runs only against dev hosts. */
for (const url of [appUrl, portalUrl]) {
  if (!/^https:\/\/[a-z]+\.dev\.firmivra\.com$/.test(url)) {
    throw new Error(`live checks run only against dev, not ${url}`);
  }
}
if (firmSlug === 'lvp') throw new Error('live checks never touch LVP');

export const stateDir = (): string => {
  const dir = need('LIVE_STATE_DIR');
  mkdirSync(dir, { recursive: true });
  return dir;
};
export const statePath = (role: Role) => join(stateDir(), `${role}.json`);

export interface Login {
  email: string;
  password: string;
  totp?: string;
}

const PREFIX: Record<Role, string> = {
  owner: 'LIVE_OWNER',
  admin: 'LIVE_ADMIN',
  staff: 'LIVE_STAFF',
  client: 'LIVE_CLIENT',
  manager: 'LIVE_MANAGER',
  bookkeeper: 'LIVE_BOOKKEEPER',
  preparer: 'LIVE_PREPARER',
  support: 'LIVE_SUPPORT',
  consultant: 'LIVE_CONSULTANT',
  readonly: 'LIVE_READONLY',
  custom1: 'LIVE_CUSTOM1',
  custom2: 'LIVE_CUSTOM2',
  inbox: 'LIVE_INBOX',
};

/** The roles that sign in to the client portal (the others sign in to the firm workspace). */
export const portalRole = (role: Role) => role === 'client' || role === 'inbox';

/** The role's login, or undefined when the runner did not provide one. */
export function login(role: Role): Login | undefined {
  const p = PREFIX[role];
  const email = process.env[`${p}_EMAIL`];
  const password = process.env[`${p}_PASSWORD`];
  if (!email || !password) return undefined;
  const totp = process.env[`${p}_TOTP`];
  return totp ? { email, password, totp } : { email, password };
}

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('TOTP secret is not base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 code (SHA-1, 30 s, 6 digits) for the time step `step`. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

export const totpStep = (now = Date.now()) => Math.floor(now / 30_000);

/** Milliseconds to add to this machine's clock to get the server's (TOTP must use the server's). */
export async function serverSkew(): Promise<number> {
  const res = await fetch(`${appUrl}/healthz`, { method: 'HEAD' });
  const date = res.headers.get('date');
  // The Date header is truncated to the second: add half a second.
  return date ? Date.parse(date) + 500 - Date.now() : 0;
}

/** Screenshot folder for one tab (outside the repo). */
export function shotsDir(tab: string): string {
  const dir = join(need('LIVE_SHOTS_DIR'), tab);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A label that marks every record the harness creates, so a run can find and delete its own. */
export const runTag = `LIVE-CHECK ${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
