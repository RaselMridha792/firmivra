'use client';

import {
  type BrandingSettings,
  type FirmSettings,
  type SidebarPosition,
  type SidebarStyle,
  type ThemeMode,
  UpdateBrandingRequest,
  UpdateFirmSettingsRequest,
} from '@firmivra/types';
import { use, useState } from 'react';
import { FirmContext } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { FIRM_SETTINGS } from '../../../setup/_components/shared';

/** `api.branding`'s query key, shared by every Company Profile & Branding tab. */
export const BRANDING = ['branding'];

/**
 * What Company Profile & Branding edits, from both settings rows: `api.settings` (FirmSettings)
 * and `api.branding` (R42). Text is '' when empty; colours are '' for the default.
 */
export interface BrandDraft {
  name: string;
  /** Write-only; '' leaves the stored EIN alone. */
  ein: string;
  website: string;
  businessCategory: string;
  entityType: string;
  /** The Tagline / Motto: FirmSettings' sidebar motto. */
  tagline: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  contactPhone: string;
  /** The Support Email: FirmSettings' contact email. */
  contactEmail: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  /** Theme colours (FirmSettings); '' derives them from the primary colour. */
  sidebarColor: string;
  textPrimaryColor: string;
  textSecondaryColor: string;
  buttonColor: string;
  themeMode: ThemeMode;
  sidebarStyle: SidebarStyle;
  sidebarPosition: SidebarPosition;
  showLogoText: boolean;
  roundedCorners: boolean;
  loginMessage: string;
}

type SettingsKey =
  | 'name'
  | 'website'
  | 'entityType'
  | 'description'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'contactPhone'
  | 'contactEmail'
  | 'primaryColor'
  | 'accentColor'
  | 'sidebarColor'
  | 'textPrimaryColor'
  | 'textSecondaryColor'
  | 'buttonColor';
const SETTINGS_KEYS: SettingsKey[] = [
  'name',
  'website',
  'entityType',
  'description',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'contactPhone',
  'contactEmail',
  'primaryColor',
  'accentColor',
  'sidebarColor',
  'textPrimaryColor',
  'textSecondaryColor',
  'buttonColor',
];
type BrandingKey =
  | 'businessCategory'
  | 'secondaryColor'
  | 'backgroundColor'
  | 'themeMode'
  | 'sidebarStyle'
  | 'sidebarPosition'
  | 'showLogoText'
  | 'roundedCorners'
  | 'loginMessage';
const BRANDING_KEYS: BrandingKey[] = [
  'businessCategory',
  'secondaryColor',
  'backgroundColor',
  'themeMode',
  'sidebarStyle',
  'sidebarPosition',
  'showLogoText',
  'roundedCorners',
  'loginMessage',
];

export function fromData(s: FirmSettings, b: BrandingSettings): BrandDraft {
  return {
    name: s.name,
    ein: '',
    website: s.website ?? '',
    businessCategory: b.businessCategory ?? '',
    entityType: s.entityType ?? '',
    tagline: s.sidebarMotto ?? '',
    description: s.description ?? '',
    addressLine1: s.addressLine1 ?? '',
    addressLine2: s.addressLine2 ?? '',
    city: s.city ?? '',
    state: s.state ?? '',
    postalCode: s.postalCode ?? '',
    contactPhone: s.contactPhone ?? '',
    contactEmail: s.contactEmail ?? '',
    primaryColor: s.primaryColor ?? '',
    secondaryColor: b.secondaryColor ?? '',
    accentColor: s.accentColor ?? '',
    backgroundColor: b.backgroundColor ?? '',
    sidebarColor: s.sidebarColor ?? '',
    textPrimaryColor: s.textPrimaryColor ?? '',
    textSecondaryColor: s.textSecondaryColor ?? '',
    buttonColor: s.buttonColor ?? '',
    themeMode: b.themeMode,
    sidebarStyle: b.sidebarStyle,
    sidebarPosition: b.sidebarPosition,
    showLogoText: b.showLogoText,
    roundedCorners: b.roundedCorners,
    loginMessage: b.loginMessage ?? '',
  };
}

/** Only what changed, for each API; '' clears a text or colour. */
function patches(next: BrandDraft, before: BrandDraft) {
  const settings: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) {
    if (next[k] !== before[k]) settings[k] = k === 'name' ? next[k].trim() : next[k] || null;
  }
  if (next.tagline !== before.tagline) settings.sidebarMotto = next.tagline || null;
  if (next.ein.trim()) settings.ein = next.ein.trim();
  const branding: Record<string, unknown> = {};
  for (const k of BRANDING_KEYS) {
    if (next[k] !== before[k]) branding[k] = next[k] === '' ? null : next[k];
  }
  return { settings, branding };
}

/** The draft field a contract error belongs to. */
const fieldOf = (path: PropertyKey | undefined) =>
  path === 'sidebarMotto' ? 'tagline' : String(path ?? 'form');

/**
 * The page's one draft over both settings rows: what the person typed, over the saved values.
 * Save Changes checks each part with the contract's schema, then sends only what changed
 * (`api.settings.update`, then `api.branding.update` with its `version`). The Live Preview reads
 * the draft, so it shows unsaved changes.
 */
export function useBrandDraft() {
  const settings = useApiQuery(FIRM_SETTINGS, () => api.settings.get());
  const branding = useApiQuery(BRANDING, () => api.branding.get());
  const firmArea = use(FirmContext);
  const [changes, setChanges] = useState<Partial<BrandDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const initial = settings.data && branding.data ? fromData(settings.data, branding.data) : null;
  const draft = initial ? { ...initial, ...changes } : null;
  const set = <K extends keyof BrandDraft>(key: K, value: BrandDraft[K]) => {
    setChanges((c) => ({ ...c, [key]: value }));
    setSaved('');
    setErrors((e) => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  };

  const save = useApiMutation(
    async (parts: { settings: Record<string, unknown>; branding: Record<string, unknown> }) => {
      if (Object.keys(parts.settings).length) await api.settings.update(parts.settings);
      if (Object.keys(parts.branding).length && branding.data) {
        await api.branding.update({ version: branding.data.version, ...parts.branding });
      }
      return parts;
    },
    { invalidate: FIRM_SETTINGS },
  );
  const refreshBranding = () => void branding.refetch();

  const submit = () => {
    if (!draft || !initial) return;
    const parts = patches(draft, initial);
    const found: Record<string, string> = {};
    // The contract's website rule opens the address with `new URL`, which throws on text that is
    // no address at all; such text gets the contract's message here and is left out of the check.
    const { website, ...rest } = parts.settings;
    if (typeof website === 'string' && !URL.canParse(website)) {
      found.website = 'Enter a web address that starts with https://';
    }
    if (Object.keys(parts.settings).length) {
      const r = UpdateFirmSettingsRequest.safeParse(found.website ? rest : parts.settings);
      if (!r.success) for (const i of r.error.issues) found[fieldOf(i.path[0])] ??= i.message;
    }
    if (Object.keys(parts.branding).length && branding.data) {
      const r = UpdateBrandingRequest.safeParse({
        version: branding.data.version,
        ...parts.branding,
      });
      if (!r.success) for (const i of r.error.issues) found[fieldOf(i.path[0])] ??= i.message;
    }
    setErrors(found);
    setSaved('');
    if (Object.keys(found).length) return;
    if (!Object.keys(parts.settings).length && !Object.keys(parts.branding).length) {
      setSaved('Nothing has changed yet.');
      return;
    }
    save.mutate(parts, {
      onSuccess: () => {
        setChanges({});
        setSaved('Changes saved.');
        refreshBranding();
        if ('name' in parts.settings) void firmArea?.refresh?.();
      },
    });
  };

  return {
    settings,
    branding,
    draft,
    set,
    errors,
    saved,
    setSaved,
    dirty: Object.keys(changes).length > 0,
    discard: () => {
      setChanges({});
      setErrors({});
      setSaved('');
    },
    submit,
    save,
    refreshBranding,
  };
}
export type BrandDraftState = ReturnType<typeof useBrandDraft>;
