'use client';

import type { AdminGeneralSettings } from '@firmivra/types';
import { Button, Input, Select, Toggle } from '@firmivra/ui';
import {
  Gear,
  GlobeHemisphereWest,
  Info,
  SlidersHorizontal,
  UploadSimple,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  Body,
  BRAND_ACCEPT,
  CurrentConfiguration,
  failedStatus,
  ImportantNote,
  QuickLinks,
  SaveBar,
  savedStatus,
  SectionCard,
  SettingsHeader,
  SS,
  uploadBrandImage,
} from '../../_components/settings-kit';

const NAV = [
  { id: 'platform', label: 'Platform Information' },
  { id: 'localization', label: 'Localization' },
  { id: 'date-time', label: 'Date & Time' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'preferences', label: 'System Preferences' },
  { id: 'legal', label: 'Legal & Compliance' },
];
/** Where the tabs without a card of their own go. */
const ELSEWHERE: Record<string, string> = {
  'date-time': '#localization',
  defaults: '/system-settings/defaults',
  legal: '/system-settings/data-retention#holds',
};

const TIME_ZONES = [
  ['America/New_York', '(GMT-05:00) Eastern Time (US & Canada)'],
  ['America/Chicago', '(GMT-06:00) Central Time (US & Canada)'],
  ['America/Denver', '(GMT-07:00) Mountain Time (US & Canada)'],
  ['America/Phoenix', '(GMT-07:00) Arizona'],
  ['America/Los_Angeles', '(GMT-08:00) Pacific Time (US & Canada)'],
  ['America/Anchorage', '(GMT-09:00) Alaska'],
  ['Pacific/Honolulu', '(GMT-10:00) Hawaii'],
  ['UTC', '(GMT+00:00) Coordinated Universal Time'],
] as const;
const LANGUAGES = [
  ['en-US', 'English (US)'],
  ['es-US', 'Spanish (US)'],
] as const;
const CURRENCIES = [
  ['USD', 'USD - US Dollar ($)'],
  ['CAD', 'CAD - Canadian Dollar ($)'],
  ['EUR', 'EUR - Euro (€)'],
  ['GBP', 'GBP - British Pound (£)'],
] as const;
const DATE_FORMATS = [
  ['MM/DD/YYYY', 'MM/DD/YYYY (10/14/2026)'],
  ['DD/MM/YYYY', 'DD/MM/YYYY (14/10/2026)'],
  ['YYYY-MM-DD', 'YYYY-MM-DD (2026-10-14)'],
] as const;
const PREFERENCES: {
  key: keyof AdminGeneralSettings['preferences'];
  label: string;
  hint: string;
}[] = [
  {
    key: 'darkModeOption',
    label: 'Enable Dark Mode Option',
    hint: 'Allow users to switch between light and dark mode',
  },
  { key: 'userFeedback', label: 'Allow User Feedback', hint: 'Enable in-app feedback from users' },
  {
    key: 'productUpdates',
    label: 'Show Product Updates',
    hint: 'Display release notes and system announcements',
  },
  {
    key: 'maintenanceBanner',
    label: 'Enable Maintenance Banner',
    hint: 'Show banner during scheduled maintenance',
  },
  { key: 'helpCenter', label: 'Enable Help Center', hint: 'Show help resources in the platform' },
  {
    key: 'betaFeatures',
    label: 'Enable Beta Features',
    hint: 'Allow access to beta / early features',
  },
];
/** Firmivra's starting values ("Reset to Default"); the platform name and contacts stay. */
const DEFAULTS: Omit<
  AdminGeneralSettings,
  'platformName' | 'tagline' | 'supportEmail' | 'supportPhone'
> = {
  defaultTimeZone: 'America/New_York',
  defaultLocale: 'en-US',
  defaultCurrency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12H',
  numberFormat: '1,234.56',
  preferences: {
    darkModeOption: true,
    productUpdates: true,
    helpCenter: true,
    userFeedback: true,
    maintenanceBanner: false,
    betaFeatures: false,
  },
};

/** Keeps a stored value that is not in a list visible as itself. */
const withValue = (options: readonly (readonly [string, string])[], value: string) =>
  (options.some(([v]) => v === value) ? options : [...options, [value, value] as const]).map(
    ([v, label]) => ({ value: v, label }),
  );

/**
 * General Settings (firmivra-general-settings-dashboard.jpg; developer instructions "General
 * Settings"): the platform's name and contacts, its logo, localization and the platform-wide
 * preferences. One section (`platform_settings.general`), saved with its version.
 */
export function GeneralSettings({ appUrl }: { appUrl: string }) {
  const q = useApiQuery([...SS, 'general'], () => api.adminSettings.general());
  const branding = useApiQuery([...SS, 'branding'], () => api.adminSettings.branding());
  const [draft, setDraft] = useState<AdminGeneralSettings>();
  const [status, setStatus] = useState<Parameters<typeof SaveBar>[0]['status']>(null);
  const value = draft ?? q.data?.value;
  const save = useApiMutation(
    () => api.adminSettings.saveGeneral({ version: q.data!.version, value: value! }),
    { invalidate: [...SS] },
  );
  const set = (next: Partial<AdminGeneralSettings>) => {
    if (!value) return;
    setDraft({ ...value, ...next });
    setStatus(null);
  };
  const pref = (key: keyof AdminGeneralSettings['preferences'], on: boolean) =>
    value && set({ preferences: { ...value.preferences, [key]: on } });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="General Settings"
        subtitle="Manage platform-wide basic settings and preferences for Firmivra."
        icon={Gear}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        {NAV.map((s, i) => (
          <a
            key={s.id}
            href={ELSEWHERE[s.id] ?? `#${s.id}`}
            aria-current={i === 0 ? 'location' : undefined}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm font-medium ${i === 0 ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard
            id="platform"
            title="Platform Information"
            subtitle="These settings define the basic information for the Firmivra platform."
            icon={Info}
          >
            <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
              <Body query={{ ...q, data: value }} rows={4}>
                {(v) => (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Platform Name"
                      value={v.platformName}
                      maxLength={100}
                      onChange={(e) => set({ platformName: e.target.value })}
                    />
                    <Input
                      label="Tagline (Optional)"
                      value={v.tagline ?? ''}
                      maxLength={160}
                      onChange={(e) => set({ tagline: e.target.value || null })}
                    />
                    <div className="sm:col-span-2">
                      <Input label="Platform URL (Display)" value={appUrl} readOnly />
                    </div>
                    <Input
                      label="Support Email"
                      type="email"
                      value={v.supportEmail ?? ''}
                      onChange={(e) => set({ supportEmail: e.target.value || null })}
                    />
                    <Input
                      label="Support Phone (Optional)"
                      type="tel"
                      value={v.supportPhone ?? ''}
                      maxLength={40}
                      onChange={(e) => set({ supportPhone: e.target.value || null })}
                    />
                  </div>
                )}
              </Body>
              <PlatformLogo branding={branding} onDone={setStatus} />
            </div>
          </SectionCard>

          <SectionCard
            id="localization"
            title="Timezone & Localization"
            subtitle="Set the default timezone, language, and regional preferences for the platform."
            icon={GlobeHemisphereWest}
          >
            <Body query={{ ...q, data: value }} rows={2}>
              {(v) => (
                <div className="grid gap-4 sm:grid-cols-3" id="date-time">
                  <Select
                    label="Default Timezone"
                    value={v.defaultTimeZone}
                    onChange={(e) => set({ defaultTimeZone: e.target.value })}
                    options={withValue(TIME_ZONES, v.defaultTimeZone)}
                  />
                  <Select
                    label="Default Language"
                    value={v.defaultLocale}
                    onChange={(e) => set({ defaultLocale: e.target.value })}
                    options={withValue(LANGUAGES, v.defaultLocale)}
                  />
                  <Select
                    label="Default Currency"
                    value={v.defaultCurrency}
                    onChange={(e) => set({ defaultCurrency: e.target.value })}
                    options={withValue(CURRENCIES, v.defaultCurrency)}
                  />
                  <Select
                    label="Date Format"
                    value={v.dateFormat}
                    onChange={(e) =>
                      set({ dateFormat: e.target.value as AdminGeneralSettings['dateFormat'] })
                    }
                    options={DATE_FORMATS.map(([value, label]) => ({ value, label }))}
                  />
                  <Select
                    label="Time Format"
                    value={v.timeFormat}
                    onChange={(e) =>
                      set({ timeFormat: e.target.value as AdminGeneralSettings['timeFormat'] })
                    }
                    options={[
                      { value: '12H', label: '12 Hour (AM/PM)' },
                      { value: '24H', label: '24 Hour' },
                    ]}
                  />
                  <Select
                    label="Number Format"
                    value={v.numberFormat}
                    onChange={(e) =>
                      set({ numberFormat: e.target.value as AdminGeneralSettings['numberFormat'] })
                    }
                    options={['1,234.56', '1.234,56', '1 234,56'].map((f) => ({
                      value: f,
                      label: f,
                    }))}
                  />
                </div>
              )}
            </Body>
          </SectionCard>

          <SectionCard
            id="preferences"
            title="System Preferences"
            subtitle="Configure global platform preferences and defaults."
            icon={SlidersHorizontal}
          >
            <Body query={{ ...q, data: value }} rows={3}>
              {(v) => (
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {PREFERENCES.map((p) => (
                    <div key={p.key} className="flex items-start gap-3">
                      <Toggle
                        label={p.label}
                        checked={v.preferences[p.key]}
                        onChange={(on) => pref(p.key, on)}
                      />
                      <div className="text-sm">
                        <p className="text-heading" aria-hidden>
                          {p.label}
                        </p>
                        <p className="text-muted">{p.hint}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Body>
          </SectionCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <ImportantNote href="/audit-security?view=policies">
            These settings apply to the entire Firmivra platform and all firms. Changes may impact
            all users.
          </ImportantNote>
          <CurrentConfiguration updatedAt={q.data?.updatedAt} updatedBy={q.data?.updatedBy} />
          <QuickLinks />
          <SaveBar
            status={status}
            saving={save.isPending}
            disabled={!value}
            onReset={() => {
              if (!value) return;
              setDraft({ ...value, ...DEFAULTS });
              setStatus({
                tone: 'info',
                text: "Firmivra's defaults are filled in. Nothing changes until you save.",
              });
            }}
            onSave={() =>
              save.mutate(undefined, {
                onSuccess: (s) => {
                  setDraft(s.value);
                  setStatus(savedStatus);
                },
                onError: (e) => setStatus(failedStatus(e)),
              })
            }
          />
        </aside>
      </div>
    </div>
  );
}

/** Platform Logo: the logo in use (or Firmivra's built-in one), Change Logo and Remove. */
function PlatformLogo({
  branding,
  onDone,
}: {
  branding: ReturnType<typeof useApiQuery<Awaited<ReturnType<typeof api.adminSettings.branding>>>>;
  onDone: (s: { tone: 'ok' | 'error' | 'info'; text: string }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const logo = branding.data?.assets.LOGO ?? null;
  const upload = useApiMutation((file: File) => uploadBrandImage('LOGO', file), {
    invalidate: [...SS],
  });
  const reset = useApiMutation(() => api.adminSettings.resetBrandAsset('LOGO'), {
    invalidate: [...SS],
  });
  return (
    <div className="flex flex-col gap-2" data-testid="platform-logo">
      <p className="text-sm font-medium text-heading">Platform Logo</p>
      <div className="flex h-28 items-center justify-center rounded-lg border border-divider bg-surface p-3">
        {logo?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo.url}
            alt="Platform logo"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-sm text-muted">
            {branding.isError
              ? 'Could not load the logo'
              : logo
                ? 'Being checked…'
                : "Firmivra's built-in logo"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button
          variant="secondary"
          disabled={upload.isPending || !branding.data}
          onClick={() => input.current?.click()}
        >
          <span className="inline-flex items-center gap-2 text-action">
            <UploadSimple aria-hidden weight="bold" className="size-4" />
            {upload.isPending ? 'Uploading…' : 'Change Logo'}
          </span>
        </Button>
        <Button
          variant="secondary"
          disabled={!logo || reset.isPending}
          onClick={() =>
            reset.mutate(undefined, {
              onSuccess: () =>
                onDone({ tone: 'ok', text: "The logo is back to Firmivra's built-in one." }),
              onError: (e) => onDone(failedStatus(e)),
            })
          }
        >
          <span className="text-danger">Remove</span>
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept={BRAND_ACCEPT.join(',')}
        className="sr-only"
        aria-label="Choose a logo image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            upload.mutate(file, {
              onSuccess: (a) =>
                onDone(
                  a.scanStatus === 'CLEAN'
                    ? { tone: 'ok', text: 'The new logo is in use.' }
                    : {
                        tone: 'info',
                        text: 'The logo is being checked; set it in Branding once it is ready.',
                      },
                ),
              onError: (err) => onDone(failedStatus(err)),
            });
        }}
      />
      <p className="text-xs text-muted">
        Recommended: 400 × 120 px (PNG, transparent background). More images in{' '}
        <Link href="/system-settings/branding" className="text-action">
          Branding
        </Link>
        .
      </p>
    </div>
  );
}
