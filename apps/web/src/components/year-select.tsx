'use client';

import { Input, Select } from '@firmivra/ui';
import { useState } from 'react';
import { YEAR_MAX, YEAR_MIN, customYear, yearChoices } from '../lib/years';

const CUSTOM = 'custom';

/**
 * Advisory B34 (Octavia, Oct 25): a year from the rolling choices (this year, six back, three
 * ahead), the years already stored (`stored`, and the current value, so nothing a record says is
 * lost), or a custom year typed in. `empty` is the first choice's label ("All years", "None").
 */
export function YearSelect({
  label,
  value,
  onChange,
  stored = [],
  empty,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (year: string) => void;
  stored?: readonly (number | string | null | undefined)[];
  empty: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [custom, setCustom] = useState(false);
  const [typed, setTyped] = useState('');
  const years = yearChoices([...stored, value]);
  const typedYear = customYear(typed);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        label={label}
        data-testid={testId}
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (next === CUSTOM) {
            setCustom(true);
            setTyped('');
            return;
          }
          setCustom(false);
          onChange(next);
        }}
        options={[
          { value: '', label: empty },
          ...years.map((y) => ({ value: y, label: y })),
          { value: CUSTOM, label: 'Custom year…' },
        ]}
      />
      {custom ? (
        <Input
          label={`${label}: custom year`}
          inputMode="numeric"
          maxLength={4}
          placeholder="YYYY"
          value={typed}
          error={
            typed.length === 4 && !typedYear
              ? `Use a year from ${YEAR_MIN} to ${YEAR_MAX}.`
              : undefined
          }
          onChange={(event) => {
            const next = event.target.value;
            setTyped(next);
            const year = customYear(next);
            if (year) {
              setCustom(false);
              onChange(year);
            }
          }}
        />
      ) : null}
    </div>
  );
}
