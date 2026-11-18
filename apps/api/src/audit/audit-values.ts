/**
 * Audit Log Review 2, M03 and R03 (the lead's DECISIONS.md, "Audit Log" 2): what an audit row may
 * hold of a value, in one place for every module.
 * - A secret (a password, a one-time or reset code, a token, an API or private key, a card,
 *   bank account or routing number) is never written: its value becomes "[redacted]".
 * - A tax id (SSN, EIN, ITIN, TIN, tax id) keeps its last 4 only: "•••6789".
 * - In a before/after change, free text (notes, messages, descriptions, bodies) is "changed",
 *   never its text.
 * `AuditService` applies `redactMetadata` to every row it writes; `auditChanges` (audit-changes.ts)
 * builds an update's before/after with the same rules. A key is judged by its last word, so
 * `password` and `newPassword` are secrets while `passwordChangedAt` and `tokenId` are not.
 */

export const REDACTED = '[redacted]';
export const CHANGED = 'changed';

/** The words of a key: "bankAccountNumber" and "bank_account_number" are bank, account, number. */
export function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .toLowerCase()
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Last words that are secrets on their own. */
const SECRET_NOUNS = new Set([
  'password',
  'passwords',
  'passcode',
  'passphrase',
  'secret',
  'secrets',
  'token',
  'tokens',
  'otp',
  'cvv',
  'cvc',
  'pin',
  'apikey',
  'iban',
]);
/** Words before "code" that make it a secret (a postal or state code is not). */
const CODE_KINDS = new Set([
  'mfa',
  'reset',
  'verification',
  'auth',
  'otp',
  'recovery',
  'security',
  'time',
  'login',
  'sms',
  'email',
  'backup',
]);
/** Words before "key" that make it a secret (a sort or idempotency key is not). */
const KEY_KINDS = new Set([
  'api',
  'private',
  'access',
  'secret',
  'signing',
  'encryption',
  'license',
]);
/** Words before "number" that make it a secret. */
const NUMBER_KINDS = new Set(['card', 'account', 'routing', 'iban', 'pan']);

/** A key whose value is a secret, never written. */
export function isSecretKey(key: string): boolean {
  const w = wordsOf(key);
  const last = w.at(-1);
  if (!last) return false;
  const before = w.slice(0, -1);
  if (SECRET_NOUNS.has(last)) return true;
  if (last === 'code' || last === 'codes') return before.some((x) => CODE_KINDS.has(x));
  if (last === 'key' || last === 'keys') return before.some((x) => KEY_KINDS.has(x));
  if (last === 'number' || last === 'numbers') return before.some((x) => NUMBER_KINDS.has(x));
  return false;
}

/** A key whose value is a tax id: only its last 4 are written. */
export function isTaxIdKey(key: string): boolean {
  const w = wordsOf(key);
  const last = w.at(-1);
  if (!last) return false;
  if (['ssn', 'ein', 'itin', 'tin', 'taxid'].includes(last)) return true;
  return last === 'id' && w.at(-2) === 'tax';
}

/** Last words of free text, written in a change as "changed". */
const TEXT_NOUNS = new Set([
  'note',
  'notes',
  'description',
  'message',
  'body',
  'details',
  'comment',
  'comments',
  'instructions',
  'content',
  'bio',
  'memo',
  'text',
  'html',
]);

/** A key of free text: a change to it is "changed", never its text. */
export function isFreeTextKey(key: string): boolean {
  const last = wordsOf(key).at(-1);
  return last !== undefined && TEXT_NOUNS.has(last);
}

/** A tax id's last 4: "•••6789"; a value with fewer than 4 digits is redacted. */
export function lastFour(value: string | number): string {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : REDACTED;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Object.prototype.toString.call(v) === '[object Object]';

const isGuardedKey = (key: string) => isSecretKey(key) || isTaxIdKey(key);

/**
 * A value under a secret or tax-id key as it may be written. Flags (true or false) and null stay,
 * so "a password was set" can still be recorded; inside an object or a list (a change's `from`
 * and `to`) every value is guarded the same way.
 */
function guardValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => guardValue(key, v));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, guardValue(key, v)]));
  }
  if (isSecretKey(key)) return REDACTED;
  return typeof value === 'string' || typeof value === 'number' ? lastFour(value) : REDACTED;
}

function walk(value: unknown, key: string | null): unknown {
  if (key !== null && isGuardedKey(key)) return guardValue(key, value);
  if (Array.isArray(value)) return value.map((v) => walk(v, null));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
  }
  return value;
}

/**
 * The metadata as it may be written: every secret's value is "[redacted]" and every tax id keeps
 * its last 4, at any depth (a change's `from` and `to` under such a key too). Nothing else
 * changes.
 */
export function redactMetadata<T>(metadata: T): T {
  return walk(metadata, null) as T;
}
