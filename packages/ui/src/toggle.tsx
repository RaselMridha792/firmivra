'use client';

import type { ButtonHTMLAttributes } from 'react';

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The accessible name when there is no visible text next to the switch. */
  label: string;
}

/** An on/off switch (role="switch"); blue when on. */
export function Toggle({ checked, onChange, label, className = '', ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-action' : 'bg-control-border'} ${className}`}
      {...props}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  );
}
