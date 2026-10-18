import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import {
  isGridFirmRole,
  roleCan,
  type CommunicationErrorCode,
  type PermissionCapability,
  type SegmentAudience,
  type SegmentField,
} from '@firmivra/types';
import type { TenantContext } from '../common/request-context.js';

const refusal = (code: CommunicationErrorCode, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });

export const comErrors = {
  saveConflict: () =>
    refusal('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  duplicateName: () => refusal('DUPLICATE_NAME', 'A segment or list with this name exists'),
  segmentInUse: (n: number) =>
    refusal('SEGMENT_IN_USE', `${n} scheduled communication(s) use this segment`),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' }),
  invalidCriteria: (path: string, message: string) =>
    new BadRequestException({
      code: 'INVALID_CRITERIA',
      message: 'The criteria are not valid',
      details: [{ path, message }],
    }),
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

export interface Perms {
  admin: boolean;
  create: boolean;
  edit: boolean;
  manage: boolean;
  exportResults: boolean;
  /** Creating, editing, sending, segments and consent. */
  write: boolean;
}

const NONE: Perms = {
  admin: false,
  create: false,
  edit: false,
  manage: false,
  exportResults: false,
  write: false,
};

/** Owner and Admin may always; the other roles follow the grid's COMMUNICATIONS row. */
export function permsOf(tenant: TenantContext | undefined): Perms {
  if (tenant?.kind !== 'staff') return NONE;
  const role = tenant.role;
  const admin = role === 'OWNER' || role === 'ADMIN';
  const staff = role === 'STAFF';
  const grid = (cap: PermissionCapability) =>
    isGridFirmRole(role) && roleCan(role, 'COMMUNICATIONS', cap);
  const manage = admin || grid('MANAGE');
  const create = manage || staff || grid('CREATE');
  const edit = manage || staff || grid('EDIT');
  return {
    admin,
    create,
    edit,
    manage,
    exportResults: manage || grid('EXPORT'),
    write: create || edit,
  };
}

export const iso = (d: Date | null) => d?.toISOString() ?? null;

// ---------- The criteria fields segments may use ----------

const CLIENT_STATUS = [
  'NEW',
  'PENDING_DOCUMENTS',
  'IN_PROGRESS',
  'ACTIVE',
  'ON_HOLD',
  'INACTIVE',
] as const;
const LEAD_STATUS = [
  'SUBMITTED',
  'IN_REVIEW',
  'CONVERTED',
  'DECLINED',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'LOST',
] as const;
const words = (v: string) =>
  v
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: words(v) }));
const SET = ['IS', 'IS_NOT', 'IS_ANY_OF', 'IS_NONE_OF'] as const;
const DATES = ['BEFORE', 'AFTER', 'BETWEEN', 'EXISTS', 'NOT_EXISTS'] as const;

/** The catalog is served from code: what a segment may test, for whom, and how. */
export const SEGMENT_FIELDS: SegmentField[] = [
  {
    field: 'client.status',
    label: 'Client status',
    type: 'STATUS',
    audience: 'CLIENTS',
    options: options(CLIENT_STATUS),
    operators: [...SET],
  },
  {
    field: 'client.accountType',
    label: 'Account type',
    type: 'STATUS',
    audience: 'CLIENTS',
    options: options(['INDIVIDUAL', 'BUSINESS']),
    operators: ['IS', 'IS_NOT'],
  },
  {
    field: 'client.priority',
    label: 'Priority',
    type: 'STATUS',
    audience: 'CLIENTS',
    options: options(['HIGH', 'MEDIUM', 'LOW']),
    operators: [...SET, 'EXISTS', 'NOT_EXISTS'],
  },
  {
    field: 'client.source',
    label: 'Source',
    type: 'TEXT',
    audience: 'CLIENTS',
    options: [],
    operators: ['IS', 'IS_NOT', 'CONTAINS', 'EXISTS', 'NOT_EXISTS'],
  },
  {
    field: 'client.clientSince',
    label: 'Client since',
    type: 'DATE',
    audience: 'CLIENTS',
    options: [],
    operators: [...DATES],
  },
  {
    field: 'client.lastActivityAt',
    label: 'Last contact',
    type: 'DATE',
    audience: 'CLIENTS',
    options: [],
    operators: [...DATES],
  },
  {
    field: 'lead.status',
    label: 'Lead status',
    type: 'STATUS',
    audience: 'LEADS',
    options: options(LEAD_STATUS),
    operators: [...SET],
  },
];

export const fieldsFor = (audience: SegmentAudience): SegmentField[] =>
  SEGMENT_FIELDS.filter((f) => audience === 'BOTH' || f.audience === audience);

type Cond = {
  field: string;
  op: string;
  value?: string | number | boolean | string[] | { from: string | number; to: string | number };
};
type Group = { logic: 'AND' | 'OR'; conditions: Cond[] };
export type Criteria = { logic: 'AND' | 'OR'; conditions: Cond[]; groups: Group[] };

/** A condition as a Prisma column filter; throws INVALID_CRITERIA for what the catalog does not offer. */
function column(
  c: Cond,
  path: string,
  audience: SegmentAudience,
): [string, Record<string, unknown>] {
  const def = fieldsFor(audience).find((f) => f.field === c.field);
  if (!def) throw comErrors.invalidCriteria(path, `The field ${c.field} is not offered here`);
  if (!def.operators.includes(c.op as (typeof def.operators)[number]))
    throw comErrors.invalidCriteria(path, `${c.op} does not fit ${def.label}`);
  const key = c.field.split('.')[1] as string;
  const v = c.value;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const need = (ok: boolean) => {
    if (!ok) throw comErrors.invalidCriteria(path, `Give a value for ${def.label}`);
  };
  if (def.options.length) {
    for (const x of list) {
      if (!def.options.some((o) => o.value === x))
        throw comErrors.invalidCriteria(path, `${x} is not a ${def.label} value`);
    }
  }
  const date = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
  switch (c.op) {
    case 'IS':
      need(typeof v === 'string');
      return [key, { equals: v }];
    case 'IS_NOT':
      need(typeof v === 'string');
      return [key, { not: v }];
    case 'IS_ANY_OF':
      need(list.length > 0);
      return [key, { in: list }];
    case 'IS_NONE_OF':
      need(list.length > 0);
      return [key, { notIn: list }];
    case 'CONTAINS':
      need(typeof v === 'string' && v.length > 0);
      return [key, { contains: v, mode: 'insensitive' }];
    case 'EXISTS':
      return [key, { not: null }];
    case 'NOT_EXISTS':
      return [key, { equals: null }];
    case 'BEFORE':
      need(date(v));
      return [key, { lt: new Date(v as string) }];
    case 'AFTER':
      need(date(v));
      return [key, { gt: new Date(v as string) }];
    case 'BETWEEN': {
      const r = v as { from: string; to: string } | undefined;
      need(!!r && typeof r === 'object' && date(r.from) && date(r.to));
      return [
        key,
        { gte: new Date((r as { from: string }).from), lte: new Date((r as { to: string }).to) },
      ];
    }
    default:
      throw comErrors.invalidCriteria(path, `${c.op} is not supported`);
  }
}

/** The Prisma filter for one side (clients or leads) of the criteria; also validates every condition. */
export function whereFor(
  criteria: Criteria,
  side: 'client' | 'lead',
  audience: SegmentAudience,
): Prisma.ClientWhereInput & Prisma.LeadWhereInput {
  const own = (conds: Cond[], base: string) =>
    conds.flatMap((c, i) => {
      const [k, f] = column(c, `${base}[${i}]`, audience);
      return c.field.startsWith(`${side}.`) ? [{ [k]: f }] : [];
    });
  const top = own(criteria.conditions, 'criteria.conditions');
  const groups = criteria.groups.flatMap((g, i) => {
    const parts = own(g.conditions, `criteria.groups[${i}].conditions`);
    if (!parts.length) return [];
    return [g.logic === 'AND' ? { AND: parts } : { OR: parts }];
  });
  const all = [...top, ...groups];
  const joined = all.length === 0 ? {} : criteria.logic === 'AND' ? { AND: all } : { OR: all };
  return joined as Prisma.ClientWhereInput & Prisma.LeadWhereInput;
}

/** Checks every condition against the catalog (400 INVALID_CRITERIA). */
export function validateCriteria(criteria: Criteria, audience: SegmentAudience): void {
  whereFor(criteria, 'client', audience);
  whereFor(criteria, 'lead', audience);
}

export function summarize(criteria: Criteria): string {
  const label = (c: Cond) => {
    const f = SEGMENT_FIELDS.find((x) => x.field === c.field);
    const v = Array.isArray(c.value)
      ? c.value.join(', ')
      : typeof c.value === 'object' && c.value !== null
        ? `${c.value.from} to ${c.value.to}`
        : String(c.value ?? '');
    return `${f?.label ?? c.field} ${c.op.toLowerCase().replace(/_/g, ' ')} ${v}`.trim();
  };
  const parts = [
    ...criteria.conditions.map(label),
    ...criteria.groups.map(
      (g) => `(${g.conditions.map(label).join(g.logic === 'AND' ? ' and ' : ' or ')})`,
    ),
  ];
  return parts.length
    ? parts.join(criteria.logic === 'AND' ? ' and ' : ' or ').slice(0, 500)
    : 'Everyone';
}

/** "j***@example.com" or "***-***-1234". */
export function mask(address: string | null | undefined): string {
  if (!address) return '';
  const at = address.indexOf('@');
  if (at > 0) return `${address[0]}***${address.slice(at)}`;
  return `***-***-${address.replace(/\D/g, '').slice(-4)}`;
}
