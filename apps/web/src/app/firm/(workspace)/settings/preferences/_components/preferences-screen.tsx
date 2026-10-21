'use client';

import type { BrandingSettings, FirmPreferences, FirmSettings } from '@firmivra/types';
import { Button, Callout, Select, Skeleton } from '@firmivra/ui';
import { Clock, GearSix, Globe, Info, NumberSquareOne } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { FIRM_SETTINGS } from '../../../../setup/_components/shared';
import {
  Facts,
  NOT_LOADED,
  Quiet,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

const TIME_ZONES: [string, string][] = [
  ['America/New_York', '(GMT-05:00) Eastern Time (US & Canada)'],
  ['America/Chicago', '(GMT-06:00) Central Time (US & Canada)'],
  ['America/Denver', '(GMT-07:00) Mountain Time (US & Canada)'],
  ['America/Phoenix', '(GMT-07:00) Arizona'],
  ['America/Los_Angeles', '(GMT-08:00) Pacific Time (US & Canada)'],
  ['America/Anchorage', '(GMT-09:00) Alaska'],
  ['Pacific/Honolulu', '(GMT-10:00) Hawaii'],
  ['America/Puerto_Rico', '(GMT-04:00) Atlantic Time (Puerto Rico)'],
];
/** Each language named in itself (guide, "Persistence and selector"). */
const LOCALES: [string, string][] = [
  ['en-US', 'English (United States)'],
  ['es-US', 'Español (Estados Unidos)'],
  ['en-CA', 'English (Canada)'],
  ['fr-CA', 'Français (Canada)'],
  ['en-GB', 'English (United Kingdom)'],
];
const CURRENCIES: [string, string][] = [
  ['USD', 'US Dollar (USD)'],
  ['CAD', 'Canadian Dollar (CAD)'],
  ['EUR', 'Euro (EUR)'],
  ['GBP', 'British Pound (GBP)'],
];
const DATE_FORMATS: FirmPreferences['dateFormat'][] = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
const NUMBER_FORMATS: FirmPreferences['numberFormat'][] = ['1,234.56', '1.234,56', '1 234,56'];

const PREFERENCE_ERRORS: Record<string, string> = {
  SAVE_CONFLICT:
    'Someone saved these preferences while you were editing. Reload to see their changes, then make yours again.',
  FORBIDDEN: 'Only an Owner or an Admin can change system preferences.',
};

/** Today in the chosen date format, in the chosen time zone. */
function sampleDate(format: FirmPreferences['dateFormat'], zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const [y, m, d] = [get('year'), get('month'), get('day')];
  return format === 'MM/DD/YYYY'
    ? `${m}/${d}/${y}`
    : format === 'DD/MM/YYYY'
      ? `${d}/${m}/${y}`
      : `${y}-${m}-${d}`;
}

/** 12,345.67 in the chosen number format, with the currency's code. */
function sampleAmount(format: FirmPreferences['numberFormat'], currency: string): string {
  const [group, decimal] =
    format === '1,234.56' ? [',', '.'] : format === '1.234,56' ? ['.', ','] : [' ', ','];
  return `${currency} 12${group}345${decimal}67`;
}

function sampleTime(zone: string): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Settings > System Preferences (guide §2, §11, §17.1 Preferences): the firm's time zone
 * (`api.settings`, used by schedules, reports and appointments) and its locale, currency, date
 * and number formats (`api.branding` preferences), with a live example. Changing the currency
 * never converts past invoices or payments (nothing converts: invoices keep their own currency).
 * The language is saved, but no screen, email or text message is translated yet, so the page
 * says so under the choice.
 */
export function PreferencesScreen() {
  const firm = useApiQuery(FIRM_SETTINGS, () => api.settings.get());
  const branding = useApiQuery(['branding'], () => api.branding.get());
  // Kept here: a save refetches, and the new values refill the form below.
  const [saved, setSaved] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={GearSix}
        title="System Preferences"
        subtitle="Time zone, language, currency, and the date and number formats your firm uses."
      />
      {firm.data && branding.data ? (
        <PreferencesForm
          key={`${branding.data.version}|${firm.data.timezone}`}
          firm={firm.data}
          branding={branding.data}
          saved={saved}
          onSaved={setSaved}
          onFirmSaved={async () => {
            await firm.refetch();
          }}
          onReload={() => void branding.refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {['Regional Settings', 'Formats', 'Live Example'].map((title) => (
            <SettingsCard
              key={title}
              title={title}
              icon={title === 'Formats' ? NumberSquareOne : Globe}
            >
              {firm.isPending || branding.isPending ? (
                <Skeleton className="h-24" />
              ) : (
                <Quiet>{NOT_LOADED}</Quiet>
              )}
            </SettingsCard>
          ))}
        </div>
      )}
    </div>
  );
}

function PreferencesForm({
  firm,
  branding,
  saved,
  onSaved: setSaved,
  onFirmSaved,
  onReload,
}: {
  firm: FirmSettings;
  branding: BrandingSettings;
  saved: string;
  onSaved: (text: string) => void;
  onFirmSaved: () => Promise<void>;
  onReload: () => void;
}) {
  const noteId = useId();
  const [zone, setZone] = useState(firm.timezone);
  const [prefs, setPrefs] = useState<FirmPreferences>(branding.preferences);
  const save = useApiMutation(
    async () => {
      if (zone !== firm.timezone) {
        await api.settings.update({ timezone: zone });
        await onFirmSaved();
      }
      const changed = (Object.keys(prefs) as (keyof FirmPreferences)[]).some(
        (k) => prefs[k] !== branding.preferences[k],
      );
      if (changed) await api.branding.update({ version: branding.version, preferences: prefs });
      // Said here: the saved version refills this form before mutate's own callback would run.
      setSaved(
        changed || zone !== firm.timezone ? 'Preferences saved.' : 'Nothing has changed yet.',
      );
    },
    { invalidate: ['branding'] },
  );
  const set = <K extends keyof FirmPreferences>(k: K, v: FirmPreferences[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setSaved('');
  };
  const zones = TIME_ZONES.some(([z]) => z === zone)
    ? TIME_ZONES
    : [[zone, zone] as [string, string], ...TIME_ZONES];
  const options = (list: [string, string][]) => list.map(([value, label]) => ({ value, label }));
  const plain = (list: string[]) => list.map((value) => ({ value, label: value }));

  return (
    <form
      noValidate
      aria-label="System preferences"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Regional Settings"
          subtitle="Used by schedules, reports, reminders and appointments."
          icon={Globe}
          testId="regional-settings"
        >
          <Select
            label="Time Zone"
            options={options(zones)}
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setSaved('');
            }}
          />
          <Select
            label="Language & Region"
            options={options(LOCALES)}
            value={prefs.locale}
            aria-describedby={`${noteId}-language`}
            onChange={(e) => set('locale', e.target.value)}
          />
          <p id={`${noteId}-language`} className="text-xs text-muted">
            Screens, emails and text messages are in English for now. The language you pick is saved
            but not applied yet.
          </p>
          <Select
            label="Currency"
            options={options(CURRENCIES)}
            value={prefs.currency}
            aria-describedby={`${noteId}-currency`}
            onChange={(e) => set('currency', e.target.value)}
          />
          <p id={`${noteId}-currency`} className="text-xs text-muted">
            Changing the currency never converts past invoices or payments. They keep their original
            amounts and currencies.
          </p>
        </SettingsCard>
        <SettingsCard
          title="Formats"
          subtitle="How dates and numbers show across the workspace and portal."
          icon={NumberSquareOne}
          testId="formats"
        >
          <Select
            label="Date Format"
            options={plain(DATE_FORMATS)}
            value={prefs.dateFormat}
            onChange={(e) => set('dateFormat', e.target.value as FirmPreferences['dateFormat'])}
          />
          <Select
            label="Number Format"
            options={plain(NUMBER_FORMATS)}
            value={prefs.numberFormat}
            onChange={(e) => set('numberFormat', e.target.value as FirmPreferences['numberFormat'])}
          />
        </SettingsCard>
        <SettingsCard
          title="Live Example"
          subtitle="What your staff and clients see with these choices."
          icon={Clock}
          testId="live-example"
        >
          <Facts
            rows={[
              ['Today', sampleDate(prefs.dateFormat, zone)],
              ['Time now', sampleTime(zone)],
              ['An amount', sampleAmount(prefs.numberFormat, prefs.currency)],
            ]}
          />
        </SettingsCard>
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          Theme, colours and the sidebar are in Branding. Each person&apos;s own notification
          choices are in Notifications.
        </Callout>
      </div>
      {save.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          {errorMessage(save.error, PREFERENCE_ERRORS)}
          {errorCode(save.error) === 'SAVE_CONFLICT' ? (
            <Button variant="secondary" onClick={onReload}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {saved ? (
          <span role="status" data-testid="preferences-saved" className="text-sm text-success">
            {saved}
          </span>
        ) : null}
        <div className="ml-auto flex gap-3">
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={() => {
              setZone(firm.timezone);
              setPrefs(branding.preferences);
              setSaved('');
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save Changes
          </Button>
        </div>
      </div>
    </form>
  );
}
