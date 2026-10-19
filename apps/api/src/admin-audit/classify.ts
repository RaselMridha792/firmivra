import type { Prisma } from '@firmivra/db';
import type {
  AdminAuditCategory,
  AdminAuditOutcome,
  AdminAuditSeverity,
  AdminAuditView,
} from '@firmivra/types';

// How the Super Admin log reads rows written before the normalized event fields (R0 stage B4):
// their category, severity and outcome come from their action. A rule matches an exact action or
// a prefix; the first match wins; a row that matches none is DATA, INFO, SUCCESS. The same rules
// become the database filters, so a filter by severity or view finds the classified rows and the
// rows the rules classify alike.

type Category = AdminAuditCategory;
type Severity = AdminAuditSeverity;
type Outcome = AdminAuditOutcome;

interface Rule {
  /** Exact actions. */
  exact?: readonly string[];
  /** Action prefixes. */
  prefix?: readonly string[];
  /** Action suffixes. */
  suffix?: readonly string[];
  category: Category;
  severity: Severity;
  outcome: Outcome;
}

/** Ordered: the first rule that matches decides. */
export const RULES: readonly Rule[] = [
  {
    exact: ['auth.sign_in_failed', 'auth.mfa_failed', 'auth.mfa_setup_failed'],
    category: 'AUTHENTICATION',
    severity: 'MEDIUM',
    outcome: 'FAILURE',
  },
  {
    exact: ['auth.sign_in_blocked', 'auth.locked', 'staff.locked'],
    category: 'SECURITY',
    severity: 'HIGH',
    outcome: 'DENIED',
  },
  {
    exact: ['staff.mfa_reset', 'staff.sessions_revoked', 'policy.changed', 'secret.rotated'],
    category: 'SECURITY',
    severity: 'HIGH',
    outcome: 'SUCCESS',
  },
  { prefix: ['security_alert.'], category: 'SECURITY', severity: 'MEDIUM', outcome: 'SUCCESS' },
  { prefix: ['auth.'], category: 'AUTHENTICATION', severity: 'INFO', outcome: 'SUCCESS' },
  {
    exact: [
      'membership.role_changed',
      'role.permissions_saved',
      'role.permissions_reset',
      'staff.permissions_saved',
    ],
    category: 'AUTHORIZATION',
    severity: 'HIGH',
    outcome: 'SUCCESS',
  },
  {
    prefix: ['membership.', 'support_access.', 'invite.'],
    category: 'AUTHORIZATION',
    severity: 'MEDIUM',
    outcome: 'SUCCESS',
  },
  {
    prefix: ['integration.', 'integrations.'],
    category: 'INTEGRATION',
    severity: 'LOW',
    outcome: 'SUCCESS',
  },
  {
    suffix: ['.exported', '.export_created'],
    category: 'DATA',
    severity: 'MEDIUM',
    outcome: 'SUCCESS',
  },
  { suffix: ['.deleted'], category: 'DATA', severity: 'LOW', outcome: 'SUCCESS' },
  { prefix: ['audit.', 'audit_note.'], category: 'SYSTEM', severity: 'INFO', outcome: 'SUCCESS' },
];
const FALLBACK = { category: 'DATA', severity: 'INFO', outcome: 'SUCCESS' } as const;

const matches = (rule: Rule, action: string) =>
  (rule.exact?.includes(action) ?? false) ||
  (rule.prefix?.some((p) => action.startsWith(p)) ?? false) ||
  (rule.suffix?.some((s) => action.endsWith(s)) ?? false);

/** The rule's own filter on `action`. */
const actionWhere = (rule: Rule): Prisma.AuditLogWhereInput => ({
  OR: [
    ...(rule.exact?.length ? [{ action: { in: [...rule.exact] } }] : []),
    ...(rule.prefix ?? []).map((p) => ({ action: { startsWith: p } })),
    ...(rule.suffix ?? []).map((s) => ({ action: { endsWith: s } })),
  ],
});

export interface Classified {
  category: Category;
  severity: Severity;
  outcome: Outcome;
  classified: boolean;
}

/** A row's category, severity and outcome: its own, or its action's. */
export function classify(row: {
  action: string;
  category: Category | null;
  severity: Severity | null;
  outcome: Outcome | null;
}): Classified {
  if (row.category && row.severity && row.outcome)
    return {
      category: row.category,
      severity: row.severity,
      outcome: row.outcome,
      classified: true,
    };
  const rule = RULES.find((r) => matches(r, row.action)) ?? FALLBACK;
  return {
    category: rule.category,
    severity: rule.severity,
    outcome: rule.outcome,
    classified: false,
  };
}

/**
 * Rows of one value: classified rows with it, and unclassified rows whose first matching rule
 * gives it (or, for the fallback's values, that match no rule at all).
 */
function byValue(
  field: 'category' | 'severity' | 'outcome',
  values: readonly string[],
): Prisma.AuditLogWhereInput {
  const own: Prisma.AuditLogWhereInput = { [field]: { in: values } } as Prisma.AuditLogWhereInput;
  const derived: Prisma.AuditLogWhereInput[] = [];
  RULES.forEach((rule, i) => {
    if (!values.includes(rule[field])) return;
    // This rule decides only when no earlier rule matched.
    derived.push({
      AND: [
        actionWhere(rule),
        ...RULES.slice(0, i).map((earlier) => ({ NOT: actionWhere(earlier) })),
      ],
    });
  });
  if (values.includes(FALLBACK[field]))
    derived.push({ AND: RULES.map((rule) => ({ NOT: actionWhere(rule) })) });
  return { OR: [own, ...(derived.length ? [{ AND: [{ category: null }, { OR: derived }] }] : [])] };
}

export const categoryWhere = (values: readonly Category[]) => byValue('category', values);
export const severityWhere = (values: readonly Severity[]) => byValue('severity', values);
export const outcomeWhere = (values: readonly Outcome[]) => byValue('outcome', values);

/** The dashboard's tabs as filters. */
export function viewWhere(view: AdminAuditView): Prisma.AuditLogWhereInput {
  switch (view) {
    case 'audit':
      return {};
    case 'security':
      return { OR: [categoryWhere(['SECURITY']), severityWhere(['HIGH', 'CRITICAL'])] };
    case 'login':
      return categoryWhere(['AUTHENTICATION']);
    case 'permissions':
      return categoryWhere(['AUTHORIZATION']);
    case 'data':
      return categoryWhere(['DATA']);
    case 'integrations':
      return categoryWhere(['INTEGRATION']);
    case 'policies':
      return {
        OR: [{ action: { startsWith: 'policy.' } }, { action: { startsWith: 'audit.policy' } }],
      };
  }
}

/** Failed sign-ins: classified failures of authentication, and the sign-in failures before. */
export const failedLoginWhere: Prisma.AuditLogWhereInput = {
  AND: [categoryWhere(['AUTHENTICATION']), outcomeWhere(['FAILURE', 'DENIED'])],
};

/** "Sign In Failed" from `auth.sign_in_failed`. */
export function actionLabel(action: string): string {
  const last = action.split('.').slice(1).join(' ') || action;
  return last
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** EVT-YYYYMMDD-XXXXXX: the day (UTC) and the id's last six characters. */
export const referenceOf = (id: string, at: Date) =>
  `EVT-${at.toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(-6).toUpperCase()}`;

/** Browser and system from a user agent: telemetry only. */
export function deviceOf(userAgent: string | null): {
  browser: string | null;
  os: string | null;
  mobile: boolean;
  label: string;
} {
  if (!userAgent) return { browser: null, os: null, mobile: false, label: 'Unknown device' };
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const mobile = /Mobi|iPhone|Android/.test(ua);
  const label =
    browser || os ? [browser ?? 'Browser', os ?? 'Unknown'].join(' / ') : 'Unknown device';
  return { browser, os, mobile, label };
}

/** Keys whose values are never shown: secrets and personal details. */
const SENSITIVE =
  /pass(word)?|token|secret|ssn|tax_?id|account(number)?|routing|card|cvc|otp|code$|key$|email|phone|address/i;

/** The metadata's own fields as changes, sensitive values masked. */
export function changesOf(
  metadata: unknown,
): { field: string; before: string | null; after: string | null; masked: boolean }[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const out: { field: string; before: string | null; after: string | null; masked: boolean }[] = [];
  const text = (v: unknown) =>
    v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
  for (const [field, value] of Object.entries(metadata as Record<string, unknown>).slice(0, 50)) {
    const masked = SENSITIVE.test(field);
    const fromTo =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ('from' in value || 'to' in value)
        ? (value as { from?: unknown; to?: unknown })
        : null;
    const before = fromTo ? text(fromTo.from) : null;
    const after = fromTo ? text(fromTo.to) : text(value);
    out.push({
      field,
      before: masked && before !== null ? '••••' : (before?.slice(0, 500) ?? null),
      after: masked && after !== null ? '••••' : (after?.slice(0, 500) ?? null),
      masked,
    });
  }
  return out;
}
