import {
  EsignPutRecipientsBody,
  type EsignPutRecipient,
  type EsignRecipient,
  type EsignRecipientRole,
} from '@firmivra/types';

/** One recipient as the Recipients step edits it; its place in the list is its signing order. */
export interface RecipientDraft {
  /** A stable key for the list (the recipient's id once saved). */
  key: string;
  id?: string;
  kind: EsignRecipient['kind'];
  role: EsignRecipientRole;
  roleLabel: string;
  /** `login:<clientAccountId>`, `staff:<userId>` or `external`. */
  who: string;
  name: string;
  email: string;
  phone: string;
  delivery: EsignRecipient['delivery'];
  authMethod: EsignRecipient['authMethod'];
  /** A new code; empty keeps the code already set. */
  accessCode: string;
  hasAccessCode: boolean;
  /** How a saved login or member reads when the lists no longer offer them. */
  savedLabel: string;
}

export type DraftErrors = Partial<Record<keyof RecipientDraft | 'row', string>>;

/** The row's boxes; a problem with anything else shows under the row. */
const BOXES = new Set(['who', 'name', 'email', 'phone', 'roleLabel', 'delivery', 'accessCode']);

let next = 0;
const newKey = () => `new-${++next}`;

export function fromRecipient(r: EsignRecipient): RecipientDraft {
  const who =
    r.link.type === 'CLIENT_LOGIN'
      ? `login:${r.link.clientAccountId}`
      : r.link.type === 'STAFF'
        ? `staff:${r.link.userId}`
        : 'external';
  return {
    key: r.id,
    id: r.id,
    kind: r.kind,
    role: r.role,
    roleLabel: r.roleLabel ?? '',
    who,
    name: r.link.type === 'EXTERNAL' ? r.name : '',
    email: r.link.type === 'EXTERNAL' ? (r.email ?? '') : '',
    phone: r.link.type === 'EXTERNAL' ? (r.phone ?? '') : '',
    delivery: r.delivery,
    authMethod: r.authMethod,
    accessCode: '',
    hasAccessCode: r.hasAccessCode,
    savedLabel: r.email ? `${r.name} (${r.email})` : r.name,
  };
}

/** The saved list in signing order. */
export const fromRecipients = (list: EsignRecipient[]): RecipientDraft[] =>
  [...list].sort((a, b) => a.routingOrder - b.routingOrder).map(fromRecipient);

export function blank(kind: EsignRecipient['kind']): RecipientDraft {
  return {
    key: newKey(),
    kind,
    // An approver is always a member of the firm; the others start as someone outside it.
    role: kind === 'APPROVER' ? 'MANAGER' : 'CLIENT',
    roleLabel: '',
    who: kind === 'APPROVER' ? '' : 'external',
    name: '',
    email: '',
    phone: '',
    delivery: 'EMAIL',
    authMethod: 'EMAIL_CODE',
    accessCode: '',
    hasAccessCode: false,
    savedLabel: '',
  };
}

/** This step's own checks: what the schema cannot see (nobody picked, a saved row with no code). */
function precheck(d: RecipientDraft): DraftErrors {
  if (d.who === '') return { who: d.kind === 'APPROVER' ? 'Choose who approves' : 'Choose who' };
  const needsCode = d.authMethod === 'ACCESS_CODE' && d.delivery !== 'IN_PERSON';
  if (needsCode && !d.accessCode && !d.hasAccessCode) return { accessCode: 'Set an access code' };
  return {};
}

function toPut(d: RecipientDraft, order: number): EsignPutRecipient {
  const [type, ref = ''] = d.who.split(':');
  const who: EsignPutRecipient['who'] =
    type === 'login'
      ? { type: 'CLIENT_LOGIN', clientAccountId: ref }
      : type === 'staff'
        ? { type: 'STAFF', userId: ref }
        : {
            type: 'EXTERNAL',
            name: d.name,
            email: d.email,
            ...(d.phone.trim() && { phone: d.phone }),
          };
  return {
    ...(d.id && { id: d.id }),
    kind: d.kind,
    role: d.role,
    ...(d.role === 'CUSTOM' && { roleLabel: d.roleLabel }),
    routingOrder: order,
    who,
    delivery: d.delivery,
    authMethod: d.authMethod,
    ...(d.accessCode && { accessCode: d.accessCode }),
  };
}

/** The PUT body, or each row's problems (and the list's own, under `list`). */
export function toBody(
  rows: RecipientDraft[],
): { ok: true; body: EsignPutRecipientsBody } | { ok: false; rows: DraftErrors[]; list?: string } {
  const errors = rows.map(precheck);
  const parsed = EsignPutRecipientsBody.safeParse({
    recipients: rows.map((d, i) => toPut(d, i + 1)),
  });
  const pre = errors.some((e) => Object.keys(e).length > 0);
  if (parsed.success && !pre) return { ok: true, body: parsed.data };
  let list: string | undefined;
  for (const issue of parsed.error?.issues ?? []) {
    const [, index, field, sub] = issue.path;
    const row = typeof index === 'number' ? errors[index] : undefined;
    if (!row) {
      list ??= issue.message;
      continue;
    }
    // `who.name` and `who.email` are the row's own boxes; anything else about `who` is the picker.
    const key = String(field === 'who' && typeof sub === 'string' ? sub : field);
    row[(BOXES.has(key) ? key : 'row') as keyof DraftErrors] ??= issue.message;
  }
  return { ok: false, rows: errors, list };
}
