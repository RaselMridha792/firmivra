import type { SaveAdminGeneralRequest } from '@firmivra/types';
import { Input, Select, Toggle } from '@firmivra/ui';
import { ClipboardText, Gear, GlobeHemisphereWest, UploadSimple } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { Controller, useFormContext } from 'react-hook-form';
import { BrandLockup } from '../../../../../../components/app-shell/brand-lockup';
import type { GeneralSettingsData } from './general-settings-data';
import { SettingsSection } from './settings-section';

const control = 'h-11 py-1.5! text-base! sm:h-9 sm:min-h-9! sm:text-xs!';
const preferenceFields = [
  [
    'darkModeOption',
    'Enable Dark Mode Option',
    'Allow users to switch between light and dark mode',
  ],
  ['userFeedback', 'Allow User Feedback', 'Enable in-app feedback from users'],
  ['productUpdates', 'Show Product Updates', 'Display release notes and system announcements'],
  ['maintenanceBanner', 'Enable Maintenance Banner', 'Show banner during scheduled maintenance'],
  ['helpCenter', 'Enable Help Center', 'Show help resources in the platform'],
  ['betaFeatures', 'Enable Beta Features', 'Allow access to beta / early features'],
] as const;

const choices = {
  defaultTimeZone: [
    ['America/New_York', '(GMT-05:00) Eastern Time (US & Canada)'],
    ['America/Chicago', '(GMT-06:00) Central Time (US & Canada)'],
    ['America/Denver', '(GMT-07:00) Mountain Time (US & Canada)'],
    ['America/Los_Angeles', '(GMT-08:00) Pacific Time (US & Canada)'],
    ['UTC', '(GMT+00:00) UTC'],
    ['Europe/London', 'London'],
    ['Asia/Dhaka', '(GMT+06:00) Dhaka'],
  ],
  defaultLocale: [
    ['en-US', 'English (US)'],
    ['en-GB', 'English (UK)'],
    ['es', 'Spanish'],
    ['fr', 'French'],
  ],
  defaultCurrency: [
    ['USD', 'USD - US Dollar ($)'],
    ['GBP', 'GBP - British Pound (£)'],
    ['EUR', 'EUR - Euro (€)'],
    ['CAD', 'CAD - Canadian Dollar ($)'],
    ['BDT', 'BDT - Bangladeshi Taka (৳)'],
  ],
  dateFormat: [
    ['MM/DD/YYYY', 'MM/DD/YYYY (10/14/2026)'],
    ['DD/MM/YYYY', 'DD/MM/YYYY (14/10/2026)'],
    ['YYYY-MM-DD', 'YYYY-MM-DD (2026-10-14)'],
  ],
  timeFormat: [
    ['12H', '12 Hour (AM/PM)'],
    ['24H', '24 Hour'],
  ],
  numberFormat: [
    ['1,234.56', '1,234.56'],
    ['1.234,56', '1.234,56'],
    ['1 234,56', '1 234,56'],
  ],
} as const;

const selectFields = [
  ['defaultTimeZone', 'Default Timezone'],
  ['defaultLocale', 'Default Language'],
  ['defaultCurrency', 'Default Currency'],
  ['dateFormat', 'Date Format'],
  ['timeFormat', 'Time Format'],
  ['numberFormat', 'Number Format'],
] as const;

export function GeneralSettingsFields({
  data,
  platformUrl,
  disabled,
  onRemoveLogo,
}: {
  data?: GeneralSettingsData;
  platformUrl: string;
  disabled: boolean;
  onRemoveLogo: () => void;
}) {
  const {
    register,
    control: formControl,
    formState: { errors },
  } = useFormContext<SaveAdminGeneralRequest>();
  const values = data?.general?.value;
  const logo = data?.branding?.assets.LOGO;

  return (
    <div className="flex min-w-0 flex-col gap-3.5 [&_label]:text-xs [&_label]:font-normal">
      <SettingsSection
        id="platform-information"
        icon={ClipboardText}
        title="Platform Information"
        subtitle="These settings define the basic information for the Firmivra platform."
      >
        <div className="grid min-w-0 gap-5 lg:grid-cols-3">
          <fieldset
            disabled={disabled}
            className="grid min-w-0 gap-x-3.5 gap-y-3.5 sm:grid-cols-2 lg:col-span-2"
          >
            <Input
              label="Platform Name"
              className={control}
              error={errors.value?.platformName?.message}
              {...register('value.platformName')}
            />
            <Input
              label="Tagline (Optional)"
              className={control}
              error={errors.value?.tagline?.message}
              {...register('value.tagline')}
            />
            <div className="sm:col-span-2">
              <Input
                label="Platform URL (Display)"
                className={control}
                value={platformUrl}
                readOnly
                placeholder="Not configured"
              />
            </div>
            <Input
              label="Support Email"
              type="email"
              className={control}
              error={errors.value?.supportEmail?.message}
              {...register('value.supportEmail')}
            />
            <Input
              label="Support Phone (Optional)"
              type="tel"
              className={control}
              error={errors.value?.supportPhone?.message}
              {...register('value.supportPhone')}
            />
          </fieldset>
          <div className="min-w-0">
            <p className="mb-2 text-xs text-heading">Platform Logo</p>
            <div className="flex min-h-24.5 items-center justify-center overflow-hidden rounded-control border border-divider px-3 py-3">
              {data?.brandingUnavailable || !data?.general ? (
                <p className="text-xs text-muted">Logo unavailable.</p>
              ) : logo?.url ? (
                <Image
                  unoptimized
                  src={logo.url}
                  alt="Platform logo"
                  width={216}
                  height={72}
                  className="h-18 w-full object-contain"
                />
              ) : (
                <BrandLockup subtitle="Super Admin Portal" />
              )}
            </div>
            <div className="mt-2 flex gap-2.5">
              {disabled ? (
                <span
                  role="link"
                  aria-disabled="true"
                  className="flex min-h-8.5 flex-1 items-center justify-center gap-2 rounded-control border border-folder-border bg-info-soft px-2 text-xs text-muted"
                >
                  <UploadSimple aria-hidden weight="fill" className="size-4" />
                  Change Logo
                </span>
              ) : (
                <Link
                  href="/system-settings/branding"
                  title="Manage the platform logo in Branding & Appearance"
                  className="flex min-h-8.5 flex-1 items-center justify-center gap-2 rounded-control border border-folder-border bg-info-soft px-2 text-xs font-semibold text-link hover:bg-folder-hover focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <UploadSimple aria-hidden weight="fill" className="size-4" />
                  Change Logo
                </Link>
              )}
              <button
                type="button"
                onClick={onRemoveLogo}
                disabled={disabled || !logo}
                title={
                  logo ? 'Restore the built-in platform logo' : 'There is no custom logo to remove'
                }
                className="min-h-8.5 rounded-control border border-divider bg-surface px-3 text-xs text-danger hover:bg-danger-soft disabled:cursor-not-allowed"
              >
                Remove
              </button>
            </div>
            <p className="mt-2 text-xs leading-4 text-muted">
              Recommended: 400 x 120 px (PNG, transparent background)
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="localization"
        icon={GlobeHemisphereWest}
        title="Timezone & Localization"
        subtitle="Set the default timezone, language, and regional preferences for the platform."
      >
        <fieldset
          disabled={disabled}
          className="grid min-w-0 gap-x-5 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {selectFields.map(([key, label]) => {
            const options = choices[key].map(([value, text]) => ({
              value: String(value),
              label: String(text),
            }));
            const saved = values?.[key];
            if (saved && !options.some(({ value }) => value === saved))
              options.push({ value: saved, label: saved });
            return (
              <Select
                key={key}
                id={key === 'dateFormat' ? 'date-time' : key}
                label={label}
                className={control}
                error={errors.value?.[key]?.message}
                options={[{ value: '', label: values ? 'Select…' : '—' }, ...options]}
                value={values ? undefined : ''}
                {...register(`value.${key}`)}
              />
            );
          })}
        </fieldset>
      </SettingsSection>

      <SettingsSection
        id="system-preferences"
        icon={Gear}
        title="System Preferences"
        subtitle="Configure global platform preferences and defaults."
        className="pb-6!"
      >
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {preferenceFields.map(([key, label, description]) => (
            <div key={key} className="flex min-w-0 items-start gap-3">
              <Controller
                name={`value.preferences.${key}`}
                control={formControl}
                render={({ field }) =>
                  values ? (
                    <Toggle
                      checked={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      label={label}
                      disabled={disabled}
                      aria-describedby={`${key}-hint`}
                      className="mt-0.5"
                    />
                  ) : (
                    <span
                      aria-label="No preference value"
                      className="mt-1 w-11 shrink-0 text-center text-muted"
                    >
                      —
                    </span>
                  )
                }
              />
              <div className="min-w-0">
                <p className="text-xs text-heading">{label}</p>
                <p id={`${key}-hint`} className="text-xs text-muted">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
