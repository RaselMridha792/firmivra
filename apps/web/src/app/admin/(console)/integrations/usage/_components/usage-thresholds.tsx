'use client';

import { Button, Input } from '@firmivra/ui';
import { useId } from 'react';
import { QuietLine } from '../../_components/integration-states';

/**
 * The optional alert thresholds (docx §10: error rate, latency, quota, cost, sync failures). B8
 * keeps no thresholds yet (asked of R0 in docs/work/R56-super-admin-api.md), so the frame shows
 * each alert as off and nothing can be saved; no numbers are made up.
 */

const FIELDS = [
  { key: 'errorRatePercent', label: 'Error rate above (%)', whole: false },
  { key: 'latencyMs', label: 'Average latency above (ms)', whole: true },
  { key: 'quotaPercent', label: 'API key peak use above (% of its rate limit)', whole: false },
  { key: 'monthlyCostCents', label: 'Provider cost in the range above ($)', whole: false },
  { key: 'syncFailures', label: 'Failed syncs above', whole: true },
] as const;

export function UsageThresholdsForm() {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <Input
            key={field.key}
            id={`${id}-${field.key}`}
            label={field.label}
            inputMode={field.whole ? 'numeric' : 'decimal'}
            placeholder="Off"
            disabled
            value=""
            onChange={() => undefined}
          />
        ))}
      </div>
      <QuietLine>Alert thresholds cannot be set yet, so every usage alert is off.</QuietLine>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled>
          Reset
        </Button>
        <Button disabled>Save Thresholds</Button>
      </div>
    </div>
  );
}
