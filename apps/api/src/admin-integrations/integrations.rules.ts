import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  ADMIN_INTEGRATION_ERRORS,
  AdminCatalogAuthType,
  AdminCatalogRequiredRole,
  AdminIntegrationBackoff,
  AdminIntegrationDataAccess,
  AdminIntegrationFirmExposure,
  AdminIntegrationLogo,
  AdminIntegrationSetupStep,
  AdminIntegrationSyncSchedule,
  type AdminConnectionTestResult,
  type AdminIntegrationErrorCode,
  type IntegrationEnvironment,
} from '@firmivra/types';
import type { ProviderDefinition } from './providers.js';

// Pure rules of the Super Admin Integrations API (R0 stage B8): what the JSON columns hold, the
// local connection test, catalog visibility and the checks the database would otherwise refuse
// with a 500. No database access here.

// ---------- Errors ----------

/** 404 NOT_FOUND, otherwise 409 with the code (the contract's `ADMIN_INTEGRATION_ERRORS`). */
export function failure(code: AdminIntegrationErrorCode, message?: string, details?: unknown) {
  const body = {
    code,
    message: message ?? ADMIN_INTEGRATION_ERRORS[code],
    ...(details === undefined ? {} : { details }),
  };
  return code === 'NOT_FOUND' ? new NotFoundException(body) : new ConflictException(body);
}
/** 400 for a value the schema lets through but the rules or the database refuse. */
export const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message });

export const ENVIRONMENT_LABELS: Readonly<Record<IntegrationEnvironment, string>> = {
  LIVE: 'Live',
  TEST: 'Test',
};

// ---------- Text and links the database checks ----------

// platform_text_ok: one visible character at least, no control characters but tab and line
// breaks, none of the invisible or direction-changing characters.
/** Code points the check refuses: control characters, invisible and direction-changing ones. */
const REFUSED: readonly (readonly [number, number])[] = [
  [0x01, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xd800, 0xdfff],
  [0xe0000, 0xe007f],
];
/** Code points it does not count as visible (besides white space). */
const BLANK: readonly (readonly [number, number])[] = [
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200f],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0xfe00, 0xfe0f],
];
const within = (point: number, ranges: typeof REFUSED) =>
  ranges.some(([from, to]) => point >= from && point <= to);

export function platformTextOk(value: string, max: number): boolean {
  if (value.length > max) return false;
  let visible = false;
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    if (within(point, REFUSED)) return false;
    if (!visible && !/\s/u.test(char) && !within(point, BLANK)) visible = true;
  }
  return visible;
}

/** A trimmed text the database keeps, or 400. */
export function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!platformTextOk(text, max)) throw invalid(`Check the ${label}: remove special characters.`);
  return text;
}
export const optionalText = (value: string | null | undefined, label: string, max: number) => {
  if (value === undefined) return undefined;
  const text = (value ?? '').trim();
  return text ? cleanText(text, label, max) : null;
};

// integrations_url_ok: https, a plain host, an optional port and path, 2048 characters at most.
const URL_OK = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/\S*)?$/;
export function cleanUrl(value: string | null | undefined, label: string): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid(`Enter the ${label} as a full address (https://…).`);
  }
  if (url.protocol !== 'https:') throw invalid(`The ${label} must start with https://.`);
  if (url.username || url.password) throw invalid(`The ${label} cannot contain a user name.`);
  const out = url.toString();
  if (out.length > 2048 || !URL_OK.test(out)) throw invalid(`Check the ${label}.`);
  return out;
}
export const optionalUrl = (value: string | null | undefined, label: string) =>
  value === undefined ? undefined : cleanUrl(value, label);

/** A key the database's lists take (`^[a-z][a-z0-9_.:-]{0,79}$`), from a label like "Most Popular". */
export function keyOf(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
  return /^[a-z]/.test(key) ? key : `b_${key || 'badge'}`;
}

/** A provider key for a name without a template: `custom_<name>`. */
export const customProviderKey = (name: string) =>
  `custom_${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'service'
  }`;

// ---------- Platform integrations: the `settings` JSON ----------

const isoOr = z.string().catch('');
const StoredValue = z.object({ value: z.string(), updatedAt: isoOr });
const StoredHint = z.object({ display: z.string(), updatedAt: isoOr });

/**
 * Non-secret options and the screens' extra fields (B8 has no column for them). Secrets never go
 * here: a secret field keeps only its masked hint. Each field falls back on its own, so a row
 * written by a seed or an older version still reads.
 */
export const StoredPlatformSettings = z.object({
  reference: z.string().catch(''),
  longDescription: z.string().nullable().catch(null),
  logo: AdminIntegrationLogo.nullable().catch(null),
  sortOrder: z.number().int().catch(0),
  setupStep: AdminIntegrationSetupStep.catch('SERVICE'),
  scopes: z.array(z.string()).catch([]),
  syncSchedule: AdminIntegrationSyncSchedule.catch('DAILY'),
  features: z.array(z.string()).catch([]),
  dataAccess: AdminIntegrationDataAccess.catch('READ_ONLY'),
  retry: z
    .object({ maxRetries: z.number().int().min(0).max(10), backoff: AdminIntegrationBackoff })
    .catch({ maxRetries: 3, backoff: 'EXPONENTIAL' }),
  firmExposure: AdminIntegrationFirmExposure.catch('PLATFORM_ONLY'),
  /** Non-secret connection values (account id, base URL). */
  values: z.record(z.string(), StoredValue).catch({}),
  /** Secret fields: the masked hint only (`sk_live_••••4242`). */
  hints: z.record(z.string(), StoredHint).catch({}),
  oauth: z
    .object({
      connected: z.boolean(),
      account: z.string().nullable(),
      connectedAt: z.string().nullable(),
    })
    .nullable()
    .catch(null),
});
export type StoredPlatformSettings = z.infer<typeof StoredPlatformSettings>;

export const readSettings = (json: unknown): StoredPlatformSettings =>
  StoredPlatformSettings.parse(json && typeof json === 'object' ? json : {});

export function newSettings(
  definition: ProviderDefinition,
  extra: Pick<StoredPlatformSettings, 'reference' | 'longDescription' | 'logo' | 'sortOrder'>,
): StoredPlatformSettings {
  return {
    ...extra,
    setupStep: 'CONNECTION',
    scopes: [...definition.defaultScopes],
    syncSchedule: 'DAILY',
    features: [],
    dataAccess: 'READ_ONLY',
    retry: { maxRetries: 3, backoff: 'EXPONENTIAL' },
    firmExposure: 'PLATFORM_ONLY',
    values: {},
    hints: {},
    oauth: definition.supportsOAuth ? { connected: false, account: null, connectedAt: null } : null,
  };
}

/** Every required field is set, and an OAuth provider's account is linked. */
export function connectionComplete(definition: ProviderDefinition, s: StoredPlatformSettings) {
  return (
    definition.fields.every(
      (f) => !f.required || (f.secret ? f.key in s.hints : Boolean(s.values[f.key]?.value)),
    ) &&
    (!definition.supportsOAuth || s.oauth?.connected === true)
  );
}
/** Any value saved (an environment change then needs its confirmation). */
export const configured = (s: StoredPlatformSettings) =>
  Object.keys(s.hints).length > 0 || Object.keys(s.values).length > 0;

export const maskSecret = (value: string, prefix: string | null) =>
  `${prefix && value.startsWith(prefix) ? prefix : ''}••••${value.slice(-4)}`;

/** One value for one field: a prefix of the other environment or a wrong prefix is refused. */
export function checkValue(
  field: ProviderDefinition['fields'][number],
  raw: string,
  environment: IntegrationEnvironment,
): string {
  const value = raw.trim();
  if (field.kind === 'url') return cleanUrl(value, field.label.toLowerCase()) ?? '';
  if (!field.secret) cleanText(value, field.label.toLowerCase(), 500);
  if (field.prefix) {
    const wanted = field.prefix[environment];
    const other = field.prefix[environment === 'LIVE' ? 'TEST' : 'LIVE'];
    if (wanted !== other && value.startsWith(other))
      throw invalid(
        `${field.label} is a ${environment === 'LIVE' ? 'test' : 'live'} value; this connection is ${ENVIRONMENT_LABELS[environment]}. Live and test credentials never mix.`,
      );
    if (!value.startsWith(wanted)) throw invalid(`${field.label} should start with ${wanted}.`);
  }
  if (field.secret && value.length < 8) throw invalid(`${field.label} looks too short.`);
  return value;
}

// ---------- Status reasons ----------

const REASONS: Record<string, { message: string; recommendedAction: string }> = {
  credentials_required: {
    message: 'No credentials are saved for this environment yet.',
    recommendedAction: 'Enter the credentials for this environment, then test the connection.',
  },
  test_required: {
    message: 'Credentials changed: test the connection to confirm them.',
    recommendedAction: 'Test the connection.',
  },
  auth_failed: {
    message: 'The provider rejected the credentials.',
    recommendedAction: 'Update the credentials in Connection Settings, then test again.',
  },
  missing_configuration: {
    message: 'A required connection value is missing.',
    recommendedAction: 'Enter every required value, then test again.',
  },
  provider_unavailable: {
    message: 'The provider did not answer.',
    recommendedAction:
      "View the provider's status and retry later. Your credentials are unchanged.",
  },
  last_test_failed: {
    message: 'Re-enabled, but the last connection test failed.',
    recommendedAction: 'Test the connection, and update the credentials if it fails again.',
  },
};
/** Reasons a passing test clears (a credential problem, not a provider's slowness). */
export const CLEARED_BY_TEST = new Set([
  'credentials_required',
  'test_required',
  'auth_failed',
  'missing_configuration',
  'last_test_failed',
]);

/** The stored code (`auth_failed`) as the screens show it (`AUTH_FAILED`), with its advice. */
export function statusReasonOf(code: string | null, lastMessage: string | null) {
  if (!code) return null;
  const known = REASONS[code];
  return {
    code: code.toUpperCase().replace(/\./g, '_'),
    message: lastMessage ?? known?.message ?? 'This integration needs attention.',
    recommendedAction: known?.recommendedAction ?? 'Open the integration and check its logs.',
  };
}

// ---------- The local connection test ----------

export type TestOutcome = Pick<AdminConnectionTestResult, 'ok' | 'kind' | 'message' | 'errorCode'>;

/**
 * The check that runs until the provider calls come with R1's secrets: every required value is
 * present (secret ones in the secret store) and carries this environment's prefix. It never calls
 * the provider, and says so. `secrets` is null when the store has nothing under the reference.
 */
export function localConnectionTest(
  definition: ProviderDefinition,
  environment: IntegrationEnvironment,
  s: StoredPlatformSettings,
  secrets: Record<string, string> | null,
): TestOutcome {
  const missing = (message: string): TestOutcome => ({
    ok: false,
    kind: 'MISSING_CONFIGURATION',
    message,
    errorCode: 'missing_configuration',
  });
  if (Object.keys(s.hints).length > 0 && secrets === null)
    return missing('The saved credentials are no longer in the secret store. Enter them again.');
  for (const field of definition.fields) {
    const value = field.secret ? secrets?.[field.key] : s.values[field.key]?.value;
    if (!value) {
      if (field.required) return missing(`Enter the ${field.label} before testing.`);
      continue;
    }
    if (field.kind === 'url' || !field.prefix) continue;
    const wanted = field.prefix[environment];
    if (!value.startsWith(wanted))
      return {
        ok: false,
        kind: 'INVALID_CREDENTIALS',
        message: `${field.label} does not start with ${wanted}: check the value and its environment.`,
        errorCode: 'auth_failed',
      };
  }
  if (definition.supportsOAuth && s.oauth?.connected !== true)
    return missing(`Link the ${definition.name} account before testing.`);
  return {
    ok: true,
    kind: 'OK',
    message: `Checked locally: every required value is set for ${ENVIRONMENT_LABELS[environment]}. The provider itself is not called yet.`,
    errorCode: null,
  };
}

// ---------- Catalog: the `setup` and `advanced` JSON ----------

export const StoredCatalogSetup = z.object({
  authType: AdminCatalogAuthType.catch('OAUTH'),
  instructions: z.string().catch(''),
  requiredFields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        secret: z.boolean(),
        required: z.boolean(),
        help: z.string().nullable(),
      }),
    )
    .catch([]),
  helpText: z.string().nullable().catch(null),
  testOnConnect: z.boolean().catch(true),
  /** Who in a firm may connect it. */
  requiredRole: AdminCatalogRequiredRole.catch('OWNER_ADMIN'),
});
export type StoredCatalogSetup = z.infer<typeof StoredCatalogSetup>;

export const StoredCatalogAdvanced = z.object({
  featureFlag: z.string().nullable().catch(null),
  beta: z.boolean().catch(false),
  deprecationNotice: z.string().nullable().catch(null),
  minAppVersion: z.string().nullable().catch(null),
  rolloutPercent: z.number().int().min(0).max(100).catch(100),
  regions: z.array(z.string()).catch([]),
  /** The firms' catalog shows this instead of the name. */
  displayLabel: z.string().nullable().catch(null),
  /** The logo's metadata (the file goes under platform/integrations/<id>/). */
  logo: AdminIntegrationLogo.nullable().catch(null),
  /** The badges as typed: the `badges` column holds their keys. */
  badgeLabels: z.record(z.string(), z.string()).catch({}),
});
export type StoredCatalogAdvanced = z.infer<typeof StoredCatalogAdvanced>;

export const readSetup = (json: unknown) =>
  StoredCatalogSetup.parse(json && typeof json === 'object' ? json : {});
export const readAdvanced = (json: unknown) =>
  StoredCatalogAdvanced.parse(json && typeof json === 'object' ? json : {});

/** Firmivra's own secrets never go into what firms read. */
export const FIRMIVRA_SECRET = /(sk_live_|sk_test_|whsec_|fv_live_|fv_test_)/;

// ---------- Catalog visibility ----------

export type Visibility = 'HIDDEN' | 'VISIBLE' | 'CONNECTABLE';
export interface AccessRules {
  status: 'ENABLED' | 'COMING_SOON' | 'DISABLED';
  planAccess: 'ALL_PLANS' | 'SELECTED_PLANS';
  planIds: ReadonlySet<string>;
  firmRules: ReadonlyMap<string, 'ALLOW' | 'DENY'>;
}

/**
 * How one firm sees an entry, in B8's order: DISABLED hides it; a firm's DENY hides it; a firm's
 * ALLOW shows it whatever the plan; otherwise the plan access decides (a firm without a plan sees
 * only ALL_PLANS entries). COMING_SOON is visible but not connectable.
 */
export function visibility(rules: AccessRules, firm: { id: string; planId: string | null }) {
  if (rules.status === 'DISABLED') return 'HIDDEN';
  const rule = rules.firmRules.get(firm.id);
  const seen =
    rule === 'DENY'
      ? false
      : rule === 'ALLOW'
        ? true
        : rules.planAccess === 'ALL_PLANS' ||
          (firm.planId !== null && rules.planIds.has(firm.planId));
  if (!seen) return 'HIDDEN';
  return rules.status === 'COMING_SOON' ? 'VISIBLE' : 'CONNECTABLE';
}

/** Firms that see the entry before the change and not after. */
export const firmsLosingAccess = (
  before: AccessRules,
  after: AccessRules,
  firms: readonly { id: string; planId: string | null }[],
) =>
  firms.filter((f) => visibility(before, f) !== 'HIDDEN' && visibility(after, f) === 'HIDDEN')
    .length;

/** "Connect", "Coming Soon" or "Not available", as the firms' card shows it. */
export const connectLabel = (status: AccessRules['status']) =>
  status === 'ENABLED' ? 'Connect' : status === 'COMING_SOON' ? 'Coming Soon' : 'Not available';
