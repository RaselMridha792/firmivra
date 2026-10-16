'use client';

import { useId, useState } from 'react';

/** `#abc`, `abc`, `#AABBCC` to `#aabbcc`; anything else is null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${[...raw].map((c) => c + c).join('')}`.toLowerCase();
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw}`.toLowerCase() : null;
}

export interface ColorPreset {
  name: string;
  value: string;
}

export interface ColorFieldProps {
  label: string;
  /** `#rrggbb`. */
  value: string;
  onChange: (hex: string) => void;
  /**
   * Named brand colours (Intake settings' "LVP Blue"): a dropdown of names next to the swatch
   * instead of the hex box.
   */
  presets?: ColorPreset[];
  hint?: string;
  error?: string;
  disabled?: boolean;
}

/**
 * A colour picker: a swatch that opens the system picker, and the hex code you can type
 * (Settings' Brand Colors). Shown in capitals, stored in lower case.
 */
export function ColorField({
  label,
  value,
  onChange,
  presets,
  hint,
  error,
  disabled,
}: ColorFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value.toUpperCase());
  // A new value from outside replaces what is typed (React's "adjust state on prop change").
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value.toUpperCase());
  }
  const invalid = normalizeHex(draft) === null;
  const message = error ?? (invalid ? 'Use a colour like #1E73F8' : hint);
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={presets ? `${id}-preset` : `${id}-hex`}
        className="text-sm font-semibold text-heading"
      >
        {label}
      </label>
      <div
        className={`flex items-center gap-3 rounded-lg border bg-surface p-1.5 ${error || invalid ? 'border-danger' : 'border-border'}`}
      >
        <span className="relative size-9 shrink-0">
          <span
            aria-hidden
            className="absolute inset-0 rounded-md border border-border"
            style={{ backgroundColor: normalizeHex(value) ?? undefined }}
          />
          <input
            type="color"
            aria-label={`${label}: choose a colour`}
            disabled={disabled}
            value={normalizeHex(value) ?? '#000000'}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </span>
        {presets ? (
          <select
            id={`${id}-preset`}
            disabled={disabled}
            value={presets.find((p) => normalizeHex(p.value) === normalizeHex(value))?.value ?? ''}
            onChange={(e) => onChange(normalizeHex(e.target.value) ?? value)}
            className="min-w-0 flex-1 bg-transparent pr-2 text-sm text-text"
          >
            {presets.some((p) => normalizeHex(p.value) === normalizeHex(value)) ? null : (
              <option value="">{value.toUpperCase()}</option>
            )}
            {presets.map((p) => (
              <option key={p.value} value={p.value}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-hex`}
            disabled={disabled}
            value={draft}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!!error || invalid}
            aria-describedby={message ? `${id}-help` : undefined}
            onChange={(e) => {
              setDraft(e.target.value.toUpperCase());
              const hex = normalizeHex(e.target.value);
              if (hex && e.target.value.replace('#', '').length === 6) onChange(hex);
            }}
            onBlur={() => {
              const hex = normalizeHex(draft);
              if (hex) onChange(hex);
            }}
            className="min-h-0 w-full min-w-0 bg-transparent text-sm text-text uppercase focus:outline-none"
          />
        )}
      </div>
      {message ? (
        <p
          id={`${id}-help`}
          className={`text-xs ${error || invalid ? 'text-danger' : 'text-muted'}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
