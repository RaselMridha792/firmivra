import type {
  AdminBrandingSettings,
  AdminEmailSettings,
  AdminGeneralSettings,
} from '@firmivra/types';

// The platform_settings sections (R0 stage B7) as the contract's settings, and back. The database
// checks a few keys of each section; the page's other fields live beside them in the same JSON
// (a section keeps keys this page does not manage). Missing keys read as Firmivra's defaults.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T =>
  values.includes(v as T) ? (v as T) : fallback;

export function generalOf(value: unknown): AdminGeneralSettings {
  const v = obj(value);
  const p = obj(v.preferences);
  return {
    platformName: str(v.platformName, 'Firmivra'),
    tagline: strOrNull(v.tagline),
    supportEmail: strOrNull(v.supportEmail),
    supportPhone: strOrNull(v.supportPhone),
    defaultTimeZone: str(v.defaultTimeZone, 'America/New_York'),
    defaultLocale: str(v.defaultLocale, 'en-US'),
    defaultCurrency: str(v.defaultCurrency, 'USD'),
    dateFormat: oneOf(v.dateFormat, ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], 'MM/DD/YYYY'),
    timeFormat: oneOf(v.timeFormat, ['12H', '24H'], '12H'),
    numberFormat: oneOf(v.numberFormat, ['1,234.56', '1.234,56', '1 234,56'], '1,234.56'),
    preferences: {
      darkModeOption: bool(p.darkModeOption, true),
      productUpdates: bool(p.productUpdates, true),
      helpCenter: bool(p.helpCenter, true),
      userFeedback: bool(p.userFeedback, true),
      maintenanceBanner: bool(p.maintenanceBanner, true),
      betaFeatures: bool(p.betaFeatures, false),
    },
  };
}

export const generalValue = (old: unknown, s: AdminGeneralSettings): Json => ({
  ...obj(old),
  ...s,
});

export function brandingOf(value: unknown): AdminBrandingSettings {
  const v = obj(value);
  const c = obj(v.colors);
  const login = obj(v.login);
  const portal = obj(v.portal);
  const hex = (x: unknown) => (typeof x === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x) ? x : null);
  return {
    tagline: strOrNull(v.tagline),
    description: strOrNull(v.description),
    colors: {
      primary: hex(v.primaryAccent),
      secondary: hex(v.secondaryAccent),
      accent: hex(c.accent),
      background: hex(c.background),
      text: hex(c.text),
      sidebar: hex(c.sidebar),
    },
    appearance: oneOf(v.appearance, ['LIGHT', 'DARK', 'SYSTEM'], 'SYSTEM'),
    allowUserAppearance: bool(v.allowUserAppearance, true),
    sidebarStyle: oneOf(v.sidebarStyle, ['EXPANDED', 'COLLAPSED'], 'EXPANDED'),
    borderRadius: oneOf(v.borderRadius, ['SMALL', 'MEDIUM', 'LARGE'], 'MEDIUM'),
    login: { showLogo: bool(login.showLogo, true), showTagline: bool(login.showTagline, true) },
    portal: {
      usePlatformBranding: bool(portal.usePlatformBranding, true),
      allowFirmBranding: bool(portal.allowFirmBranding, true),
    },
  };
}

/** The database checks `primaryAccent`, `secondaryAccent` and `appearance`: those keys stay its. */
export function brandingValue(old: unknown, s: AdminBrandingSettings): Json {
  const { colors, ...rest } = s;
  return {
    ...obj(old),
    ...rest,
    primaryAccent: colors.primary,
    secondaryAccent: colors.secondary,
    colors: {
      accent: colors.accent,
      background: colors.background,
      text: colors.text,
      sidebar: colors.sidebar,
    },
  };
}

export function emailOf(value: unknown): AdminEmailSettings {
  const v = obj(value);
  const ch = obj(v.channels);
  const r = obj(v.recipients);
  const group = (x: unknown) => oneOf(x, ['SUPER_ADMINS', 'ALL_ADMINS', 'NOBODY'], 'SUPER_ADMINS');
  return {
    fromName: str(v.fromName, 'Firmivra'),
    fromEmail: strOrNull(v.fromEmail),
    replyTo: strOrNull(v.replyTo),
    cc: strOrNull(v.cc),
    signature: strOrNull(v.signature),
    includeSignature: bool(v.includeSignature, false),
    channels: {
      email: bool(ch.email, true),
      inApp: bool(ch.inApp, true),
      sms: bool(ch.sms, true),
      push: bool(ch.push, false),
    },
    digest: bool(v.digest, false),
    recipients: {
      systemAlerts: group(r.systemAlerts),
      firmApplications: group(r.firmApplications),
      billing: group(r.billing),
      securityAlerts: group(r.securityAlerts),
    },
    maxRetries: num(v.maxRetries, 3),
    retryBackoffMinutes: num(v.retryBackoffMinutes, 5),
    dailyCapPerRecipient: num(v.dailyCapPerRecipient, 50),
  };
}

export const emailValue = (old: unknown, s: AdminEmailSettings): Json => ({ ...obj(old), ...s });

/** The fields that changed, by name (values only for plain ones; never secrets or text bodies). */
export function changedFields(before: Json, after: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (JSON.stringify(before[k]) === JSON.stringify(v)) continue;
    const plain = (x: unknown) =>
      typeof x === 'boolean' || typeof x === 'number' || (typeof x === 'string' && x.length <= 40);
    out[k] =
      plain(v) && (before[k] === undefined || plain(before[k]))
        ? { from: before[k] ?? null, to: v }
        : { changed: true };
  }
  return out;
}
