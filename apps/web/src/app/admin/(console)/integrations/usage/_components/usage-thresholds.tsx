'use client';

import { ApiRequestError } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useApiMutation } from '../../../../../../lib/query';
import {
  adminIntegrations,
  INTEGRATION_ERRORS,
  type SaveThresholdsBody,
  type UsageThresholds,
} from '../../../../../../mocks/admin-integrations';
import { formatDateTime, formatNumber } from '../../_components/integration-format';
import {
  integrationErrorMessage,
  loadError,
  QuietLine,
  SkeletonLines,
} from '../../_components/integration-states';
import type { Notice } from '../../_components/platform-actions';

/**
 * The optional alert thresholds (docx §10: error rate, latency, quota, cost, sync failures).
 * An empty field turns that alert off. Saving sends the version read, so a change made elsewhere
 * is refused instead of overwritten (docx §14), and the change is audited.
 */

type Key = Exclude<keyof SaveThresholdsBody, 'version'>;
const FIELDS: {
  key: Key;
  label: string;
  unit: string;
  max: number;
  whole: boolean;
  /** Shown in dollars, kept in cents. */
  cents?: boolean;
}[] = [
  { key: 'errorRatePercent', label: 'Error rate above (%)', unit: '%', max: 100, whole: false },
  { key: 'latencyMs', label: 'Average latency above (ms)', unit: 'ms', max: 120_000, whole: true },
  {
    key: 'quotaPercent',
    label: 'API key peak use above (% of its rate limit)',
    unit: '%',
    max: 100,
    whole: false,
  },
  {
    key: 'monthlyCostCents',
    label: 'Provider cost in the range above ($)',
    unit: '$',
    max: 1_000_000,
    whole: false,
    cents: true,
  },
  { key: 'syncFailures', label: 'Failed syncs above', unit: '', max: 1000, whole: true },
];

const shown = (value: number | null, cents?: boolean) =>
  value === null ? '' : String(cents ? value / 100 : value);

function ThresholdForm({
  saved,
  canEdit,
  onNotice,
  onReload,
}: {
  saved: UsageThresholds;
  canEdit: boolean;
  onNotice: (notice: Notice) => void;
  onReload: () => void;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<Key, string>>(() => ({
    errorRatePercent: shown(saved.errorRatePercent),
    latencyMs: shown(saved.latencyMs),
    quotaPercent: shown(saved.quotaPercent),
    monthlyCostCents: shown(saved.monthlyCostCents, true),
    syncFailures: shown(saved.syncFailures),
  }));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const save = useApiMutation(
    (body: SaveThresholdsBody) => adminIntegrations.saveThresholds(body),
    { invalidate: ['admin-integrations'] },
  );
  const changed = FIELDS.some(
    (field) => values[field.key].trim() !== shown(saved[field.key], field.cents),
  );
  const conflict =
    save.error instanceof ApiRequestError && save.error.code === INTEGRATION_ERRORS.CONFLICT;

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: Partial<Record<Key, string>> = {};
    const parsed: Partial<Record<Key, number | null>> = {};
    for (const field of FIELDS) {
      const text = values[field.key].trim();
      if (!text) {
        parsed[field.key] = null;
        continue;
      }
      const value = Number(text);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > field.max ||
        (field.whole && !Number.isInteger(value))
      )
        found[field.key] =
          `Enter ${field.whole ? 'a whole number' : 'a number'} from 0 to ${formatNumber(field.max)}, or leave it empty to turn this alert off.`;
      else parsed[field.key] = field.cents ? Math.round(value * 100) : value;
    }
    setErrors(found);
    const first = FIELDS.find((field) => found[field.key]);
    if (first) {
      document.getElementById(`${id}-${first.key}`)?.focus();
      return;
    }
    save.mutate(
      {
        version: saved.version,
        errorRatePercent: parsed.errorRatePercent ?? null,
        latencyMs: parsed.latencyMs ?? null,
        quotaPercent: parsed.quotaPercent ?? null,
        monthlyCostCents: parsed.monthlyCostCents ?? null,
        syncFailures: parsed.syncFailures ?? null,
      },
      {
        onSuccess: () =>
          onNotice({ tone: 'success', text: 'Alert thresholds saved. The alerts use them now.' }),
      },
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <Input
            key={field.key}
            id={`${id}-${field.key}`}
            label={field.label}
            inputMode={field.whole ? 'numeric' : 'decimal'}
            placeholder="Off"
            disabled={!canEdit || save.isPending}
            value={values[field.key]}
            error={errors[field.key]}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.key]: event.target.value }))
            }
          />
        ))}
      </div>
      <p className="text-xs text-muted">
        Leave a field empty to turn that alert off. Alerts are counted once per subject and
        condition in the range, never repeated. Last changed {formatDateTime(saved.updatedAt)} by{' '}
        {saved.updatedBy}.
      </p>
      {save.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <span>{integrationErrorMessage(save.error)}</span>
          {conflict ? (
            <Button variant="secondary" onClick={onReload}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="secondary"
          disabled={!changed || save.isPending}
          onClick={() => {
            setErrors({});
            save.reset();
            setValues({
              errorRatePercent: shown(saved.errorRatePercent),
              latencyMs: shown(saved.latencyMs),
              quotaPercent: shown(saved.quotaPercent),
              monthlyCostCents: shown(saved.monthlyCostCents, true),
              syncFailures: shown(saved.syncFailures),
            });
          }}
        >
          Reset
        </Button>
        <Button type="submit" disabled={!canEdit || !changed || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save Thresholds'}
        </Button>
      </div>
    </form>
  );
}

export function UsageThresholdsForm({
  query,
  canEdit,
  onNotice,
}: {
  query: UseQueryResult<UsageThresholds>;
  canEdit: boolean;
  onNotice: (notice: Notice) => void;
}) {
  if (query.isPending || query.isError)
    return (
      <div className="flex flex-col gap-3">
        {query.isPending ? (
          <SkeletonLines rows={4} label="Loading thresholds" />
        ) : (
          <QuietLine>{loadError(query.error)}</QuietLine>
        )}
        <div className="flex justify-end">
          <Button disabled>Save Thresholds</Button>
        </div>
      </div>
    );
  return (
    <ThresholdForm
      key={query.data.version}
      saved={query.data}
      canEdit={canEdit}
      onNotice={onNotice}
      onReload={() => void query.refetch()}
    />
  );
}
