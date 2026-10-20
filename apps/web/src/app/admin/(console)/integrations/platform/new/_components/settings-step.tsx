'use client';

import { Checkbox, Toggle } from '@firmivra/ui';
import { ArrowSquareOut, Bell } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  BACKOFFS,
  DATA_ACCESS,
  DATA_ACCESS_LABELS,
  ENVIRONMENT_LABELS,
  FIRM_EXPOSURE_LABELS,
  FIRM_EXPOSURES,
  SYNC_SCHEDULE_LABELS,
  SYNC_SCHEDULES,
  type Backoff,
  type DataAccess,
  type FirmExposure,
  type PlatformIntegration,
  type PlatformIntegrationDetail,
  type PlatformSettings,
  type ProviderTemplate,
  type SetupStep,
  type SyncSchedule,
} from '../../../_components/integrations-contract';
import { EnvironmentBadge } from '../../../_components/integration-badges';
import {
  integrationErrorMessage,
  loadError,
  QuietLine,
  SkeletonLines,
} from '../../../_components/integration-states';
import {
  ChoiceGroup,
  ErrorSummary,
  focusFirst,
  SelectField,
  TextField,
  type FieldError,
} from './wizard-fields';
import {
  DraftGate,
  furthest,
  savedHref,
  stepHref,
  templateOf,
  useDraft,
  useProviders,
  WizardFrame,
} from './wizard-frame';

/**
 * Step 3, Settings & Access (no frame; docx §4 step 3): the environment made explicit, the
 * permissions (scopes, least privilege by default), the sync schedule, the enabled features, the
 * data access, the retry behaviour, whether a catalog entry may rely on the service, and the
 * alert thresholds that apply to it (set for every integration in Usage & Analytics).
 */

const SUBTITLE =
  'Choose what Firmivra may do with this service and how often it syncs. Start with least privilege.';
export const BACKOFF_LABELS: Record<Backoff, string> = {
  EXPONENTIAL: 'Exponential (longer wait each time)',
  FIXED: 'Fixed interval',
};
const DATA_ACCESS_HINTS: Record<DataAccess, string> = {
  READ_ONLY: 'Least privilege: Firmivra only reads from the provider.',
  READ_WRITE: 'Firmivra may also create and change records at the provider.',
};
const EXPOSURE_HINTS: Record<FirmExposure, string> = {
  PLATFORM_ONLY: 'Only Firmivra itself uses this service.',
  CATALOG:
    'A customer catalog entry may rely on it. What firms see is still set in the Customer Integration Catalog.',
};
const ID = {
  schedule: 'wiz-schedule',
  dataAccess: 'wiz-data-access',
  retries: 'wiz-retries',
  backoff: 'wiz-backoff',
  exposure: 'wiz-exposure',
} as const;
const scopeId = (scope: string) => `wiz-scope-${scope.replace(/[^\w-]/g, '-')}`;

interface SettingsValues {
  scopes: string[];
  syncSchedule: SyncSchedule;
  features: string[];
  dataAccess: DataAccess;
  maxRetries: string;
  backoff: Backoff;
  firmExposure: FirmExposure;
}

function valuesOf(draft: PlatformIntegration): SettingsValues {
  const { settings } = draft;
  return {
    scopes: settings.scopes,
    syncSchedule: settings.syncSchedule,
    features: settings.features,
    dataAccess: settings.dataAccess,
    maxRetries: String(settings.retry.maxRetries),
    backoff: settings.retry.backoff,
    firmExposure: settings.firmExposure,
  };
}
function settingsOf(values: SettingsValues): PlatformSettings {
  return {
    scopes: values.scopes,
    syncSchedule: values.syncSchedule,
    features: values.features,
    dataAccess: values.dataAccess,
    retry: { maxRetries: Number(values.maxRetries), backoff: values.backoff },
    firmExposure: values.firmExposure,
  };
}
/** The same settings, whatever the order the boxes were ticked in. */
const sameSettings = (a: PlatformSettings, b: PlatformSettings) => {
  const key = (value: PlatformSettings) =>
    JSON.stringify({
      ...value,
      scopes: [...value.scopes].sort(),
      features: [...value.features].sort(),
    });
  return key(a) === key(b);
};

function problemsOf(values: SettingsValues): FieldError[] {
  const retries = Number(values.maxRetries);
  return /^\d{1,2}$/.test(values.maxRetries.trim()) && retries >= 0 && retries <= 10
    ? []
    : [{ id: ID.retries, message: 'Choose from 0 to 10 retries.' }];
}

const toggled = (list: string[], item: string, on: boolean) =>
  on ? [...list.filter((value) => value !== item), item] : list.filter((value) => value !== item);

/** One titled part of the step. */
function Part({
  title,
  text,
  children,
  testId,
}: {
  title: string;
  text?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="flex flex-col gap-3 border-t border-divider pt-5 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div>
        <h3 className="text-lg font-bold text-heading">{title}</h3>
        {text ? <p className="text-sm text-muted">{text}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsStep({ draftId }: { draftId: string | null }) {
  const draft = useDraft(draftId);
  return (
    <DraftGate step="SETTINGS" draftId={draftId} query={draft} subtitle={SUBTITLE}>
      {(data) => <SettingsForm key={data.id} draft={data} />}
    </DraftGate>
  );
}

function SettingsForm({ draft }: { draft: PlatformIntegrationDetail }) {
  const router = useRouter();
  const providers = useProviders();
  const [synced, setSynced] = useState(draft.version);
  const [values, setValues] = useState(() => valuesOf(draft));
  const [attempted, setAttempted] = useState(false);
  if (draft.version !== synced) {
    setSynced(draft.version);
    setValues(valuesOf(draft));
  }

  const template = templateOf(providers.data, draft.provider);
  const set = (patch: Partial<SettingsValues>) =>
    setValues((current) => ({ ...current, ...patch }));
  const problems = attempted ? problemsOf(values) : [];
  const dirty = problemsOf(values).length > 0 || !sameSettings(settingsOf(values), draft.settings);

  const save = useApiMutation(
    (setupStep: SetupStep | null) =>
      adminIntegrations.updatePlatform(draft.id, {
        version: draft.version,
        ...(sameSettings(settingsOf(values), draft.settings)
          ? {}
          : { settings: settingsOf(values) }),
        ...(setupStep ? { setupStep } : {}),
      }),
    { invalidate: ['admin-integrations'] },
  );

  function submit(mode: 'continue' | 'draft') {
    setAttempted(true);
    const found = problemsOf(values);
    if (found.length) {
      focusFirst(found);
      return;
    }
    save.mutate(mode === 'continue' ? furthest(draft.setupStep, 'REVIEW') : null, {
      onSuccess: () =>
        router.push(
          mode === 'continue' ? stepHref(draft.id, 'REVIEW') : savedHref(draft.id, 'draft'),
        ),
    });
  }

  /** The parts that list the provider's own scopes and features, in their three states. */
  const fromTemplate = (render: (loaded: ProviderTemplate) => ReactNode) =>
    providers.isPending ? (
      <SkeletonLines rows={2} />
    ) : providers.isError || !template ? (
      <QuietLine>{loadError(providers.error)}</QuietLine>
    ) : (
      render(template)
    );

  return (
    <WizardFrame
      step="SETTINGS"
      draft={draft}
      subtitle={SUBTITLE}
      dirty={dirty}
      busy={save.isPending}
      onContinue={() => submit('continue')}
      onSaveDraft={() => submit('draft')}
      alert={
        save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(save.error)}
          </p>
        ) : null
      }
    >
      <ErrorSummary errors={problems} />

      <div className="flex flex-col gap-5">
        <Part
          title="Environment"
          testId="wizard-environment"
          text={`Firmivra uses ${draft.name}'s ${draft.environment === 'LIVE' ? 'production' : 'sandbox'} account. It was chosen in General Information; changing it clears the saved credentials.`}
        >
          <span className="flex flex-wrap items-center gap-3">
            <EnvironmentBadge environment={draft.environment} />
            <Link
              href={stepHref(draft.id, 'SERVICE')}
              className="text-sm font-semibold text-link hover:underline"
            >
              Change environment
            </Link>
          </span>
        </Part>

        <Part
          title="Permissions"
          testId="wizard-scopes"
          text={
            template?.defaultScopes.length
              ? `Grant only what Firmivra needs. The least-privilege default is ${template.defaultScopes.join(', ')}.`
              : 'Grant only what Firmivra needs.'
          }
        >
          {fromTemplate(({ scopes }) =>
            scopes.length ? (
              <fieldset className="grid gap-x-6 sm:grid-cols-2">
                <legend className="sr-only">Scopes</legend>
                {scopes.map((scope) => (
                  <Checkbox
                    key={scope}
                    id={scopeId(scope)}
                    label={scope}
                    className="font-mono"
                    checked={values.scopes.includes(scope)}
                    onChange={(event) =>
                      set({ scopes: toggled(values.scopes, scope, event.target.checked) })
                    }
                  />
                ))}
              </fieldset>
            ) : (
              <QuietLine>This provider has no scopes to choose.</QuietLine>
            ),
          )}
        </Part>

        <Part title="Sync and Data Access">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id={ID.schedule}
              label="Sync Schedule"
              required
              value={values.syncSchedule}
              onChange={(event) =>
                set({
                  syncSchedule:
                    SYNC_SCHEDULES.find((item) => item === event.target.value) ??
                    values.syncSchedule,
                })
              }
              options={SYNC_SCHEDULES.map((value) => ({
                value,
                label: SYNC_SCHEDULE_LABELS[value],
              }))}
              hint="How often Firmivra pulls changes from the provider."
            />
            <ChoiceGroup
              name="data-access"
              idPrefix={ID.dataAccess}
              legend="Data Access"
              required
              value={values.dataAccess}
              onChange={(dataAccess) => set({ dataAccess })}
              options={DATA_ACCESS.map((value) => ({
                value,
                label: DATA_ACCESS_LABELS[value],
                hint: DATA_ACCESS_HINTS[value],
              }))}
            />
          </div>
        </Part>

        <Part
          title="Enabled Features"
          testId="wizard-features"
          text="Turn on only the features Firmivra uses."
        >
          {fromTemplate(({ features }) =>
            features.length ? (
              <ul className="flex flex-col divide-y divide-divider rounded-lg border border-border">
                {features.map((feature) => (
                  <li key={feature.key} className="flex items-center justify-between gap-4 p-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-heading">
                        {feature.label}
                      </span>
                      <span className="block text-xs text-muted">{feature.description}</span>
                    </span>
                    <Toggle
                      label={`Enable ${feature.label}`}
                      checked={values.features.includes(feature.key)}
                      onChange={(on) =>
                        set({ features: toggled(values.features, feature.key, on) })
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <QuietLine>This provider has no optional features.</QuietLine>
            ),
          )}
        </Part>

        <Part
          title="Retry Behavior"
          text="A failed sync is retried before the run is marked failed."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              id={ID.retries}
              label="Maximum Retries"
              required
              type="number"
              inputMode="numeric"
              min={0}
              max={10}
              value={values.maxRetries}
              onChange={(event) => set({ maxRetries: event.target.value })}
              error={problems.find((problem) => problem.id === ID.retries)?.message}
              hint="From 0 to 10."
            />
            <SelectField
              id={ID.backoff}
              label="Backoff"
              required
              value={values.backoff}
              onChange={(event) =>
                set({
                  backoff: BACKOFFS.find((item) => item === event.target.value) ?? values.backoff,
                })
              }
              options={BACKOFFS.map((value) => ({ value, label: BACKOFF_LABELS[value] }))}
            />
          </div>
        </Part>

        <Part title="Firm Exposure">
          <ChoiceGroup
            name="firm-exposure"
            idPrefix={ID.exposure}
            legend="Who may rely on this service"
            value={values.firmExposure}
            onChange={(firmExposure) => set({ firmExposure })}
            options={FIRM_EXPOSURES.map((value) => ({
              value,
              label: FIRM_EXPOSURE_LABELS[value],
              hint: EXPOSURE_HINTS[value],
            }))}
          />
        </Part>

        <Part
          title="Alerts"
          testId="wizard-alerts"
          text={`Errors and Needs Attention changes on ${draft.name} (${ENVIRONMENT_LABELS[draft.environment]}) notify the Super Admin team. Usage alert thresholds cannot be set yet, so the usage alerts below are off.`}
        >
          <Thresholds />
          <Link
            href="/integrations/usage"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-link hover:underline"
          >
            <Bell aria-hidden weight="fill" className="size-4" />
            Open Usage &amp; Analytics
            <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
          </Link>
        </Part>
      </div>
    </WizardFrame>
  );
}

/** The usage alert thresholds: none can be set yet, so each one reads "Off". */
function Thresholds() {
  const rows = [
    'Error rate above',
    'Average latency above',
    'API quota used above',
    'Monthly cost above',
    'Failed syncs above',
  ].map((label) => ({ label, value: 'Off' }));
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-subtle p-4 text-sm sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <dt className="text-muted">{row.label}</dt>
          <dd className="font-semibold text-heading">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
