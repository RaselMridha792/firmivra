import type { MergeFieldGroup } from '@firmivra/types';

// Merge fields: `[Client First Name]` tokens in a template's subject and body, filled from live
// records at use time. The master template is never rewritten with one client's data. These are
// the built-in fields (the developer guide's section 7); a firm adds its own (custom_merge_fields).

export interface BuiltInField {
  key: string;
  label: string;
  group: MergeFieldGroup;
  /** Restricted data: shown to those who may use it, and only where genuinely needed. */
  sensitive: boolean;
  /** The made-up value a preview shows. */
  example: string;
}

const f = (
  group: MergeFieldGroup,
  key: string,
  example: string,
  sensitive = false,
): BuiltInField => ({ key, label: key, group, sensitive, example });

export const BUILT_IN_FIELDS: readonly BuiltInField[] = [
  f('CLIENT', 'Client First Name', 'Jamie'),
  f('CLIENT', 'Client Last Name', 'Sample'),
  f('CLIENT', 'Client Full Name', 'Jamie Sample'),
  f('CLIENT', 'Email Address', 'jamie@example.com'),
  f('CLIENT', 'Phone Number', '(555) 010-2030'),
  f('CLIENT', 'Client Portal Link', 'https://portal.example.com/your-firm'),
  f('COMPANY', 'Business Name', 'Your Firm LLC'),
  f('COMPANY', 'Company Phone', '(555) 010-4000'),
  f('COMPANY', 'Company Email', 'office@yourfirm.example'),
  f('COMPANY', 'Company Website', 'https://yourfirm.example'),
  f('COMPANY', 'Company Address', '100 Main Street, Atlanta, GA 30303'),
  f('STAFF', 'Staff Name', 'Alex Preparer'),
  f('STAFF', 'Preparer Name', 'Alex Preparer'),
  f('STAFF', 'Advisor Name', 'Alex Advisor'),
  f('STAFF', 'Staff Email', 'alex@yourfirm.example'),
  f('STAFF', 'Staff Phone', '(555) 010-4001'),
  f('APPOINTMENT', 'Appointment Date', 'Tuesday, March 3, 2026'),
  f('APPOINTMENT', 'Appointment Time', '10:30 AM'),
  f('APPOINTMENT', 'Appointment Type', 'Tax Planning Meeting'),
  f('APPOINTMENT', 'Appointment Location/Link', 'https://meet.example.com/abc'),
  f('APPOINTMENT', 'Reschedule Link', 'https://portal.example.com/your-firm/appointments'),
  f('INVOICE', 'Invoice Number', 'INV-1001'),
  f('INVOICE', 'Invoice Date', 'March 1, 2026'),
  f('INVOICE', 'Due Date', 'March 15, 2026'),
  f('INVOICE', 'Balance Due', '$450.00', true),
  f('INVOICE', 'Payment Link', 'https://portal.example.com/your-firm/pay', true),
  f('INVOICE', 'Payment Status', 'Open', true),
  f('TAX', 'Tax Year', '2025'),
  f('TAX', 'Return Type', 'Individual (Form 1040)'),
  f('TAX', 'Filing Status', 'Married filing jointly', true),
  f('TAX', 'Organizer Link', 'https://portal.example.com/your-firm/organizer'),
  f('TAX', 'Document Upload Link', 'https://portal.example.com/your-firm/documents'),
  f('TAX', 'Signature Link', 'https://portal.example.com/your-firm/sign'),
  f('WORKFLOW', 'Task Name', 'Collect year-end documents'),
  f('WORKFLOW', 'Service Name', 'Tax Preparation'),
  f('WORKFLOW', 'Portal Message Link', 'https://portal.example.com/your-firm/messages'),
];

const BY_KEY = new Map(BUILT_IN_FIELDS.map((x) => [x.key.toLowerCase(), x]));
export const builtIn = (key: string) => BY_KEY.get(key.toLowerCase());

/** `[Field Name]`: letters, digits, spaces and a few marks, no nested brackets, on one line. */
const TOKEN = /\[([A-Za-z][A-Za-z0-9 /]{0,59})\]/g;

/** The field names a text uses, in order of first use, each once. */
export function fieldsIn(...texts: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(TOKEN)) {
      const name = m[1]!.trim();
      if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Fills the tokens of `source` from `values` (keyed by lower-cased field name). A field with no
 * value stays as its `[token]` in the text and is listed, never silently blanked, so the screen
 * can block or confirm before a real send. In `html` mode a value is escaped: data is never
 * markup.
 */
export function fill(
  source: string,
  values: ReadonlyMap<string, string>,
  mode: 'html' | 'text',
): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const text = source.replace(TOKEN, (token, name: string) => {
    const value = values.get(name.trim().toLowerCase());
    if (value === undefined || value === '') {
      unresolved.add(name.trim());
      return token;
    }
    return mode === 'html' ? escapeHtml(value) : value;
  });
  return { text, unresolved: [...unresolved] };
}

const GSM =
  /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[\]~|€]*$/;

/** An SMS: its characters and how many parts it takes (160 or 153 per part; 70 or 67 for Unicode). */
export function smsLength(text: string): { characters: number; parts: number } {
  const characters = [...text].length;
  if (characters === 0) return { characters, parts: 0 };
  const gsm = GSM.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return { characters, parts: characters <= single ? 1 : Math.ceil(characters / multi) };
}
