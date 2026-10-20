'use client';

import type { IntegrationEnvironment } from '@firmivra/types';
import { Button, Toggle } from '@firmivra/ui';

/** Two controls share one environment value; the switch is on only in live mode. */
export function EnvironmentSwitch({
  value,
  onChange,
}: {
  value: IntegrationEnvironment;
  onChange: (value: IntegrationEnvironment) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Integration environment"
      className="inline-flex items-stretch overflow-hidden rounded-control border border-border bg-surface"
    >
      <div className="flex items-center gap-2 bg-info-soft px-3 py-2">
        <Toggle
          label="Live Mode"
          checked={value === 'LIVE'}
          onChange={(checked) => onChange(checked ? 'LIVE' : 'TEST')}
        />
        <span className="whitespace-nowrap text-sm font-semibold text-action">Live Mode</span>
      </div>
      <Button
        variant="ghost"
        aria-pressed={value === 'TEST'}
        className="!rounded-none whitespace-nowrap !px-3"
        onClick={() => onChange('TEST')}
      >
        Test Mode
      </Button>
    </div>
  );
}
