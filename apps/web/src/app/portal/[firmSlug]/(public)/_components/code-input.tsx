'use client';

import { useRef } from 'react';

const SLOTS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const;
const LENGTH = SLOTS.length;

/**
 * `value` holds one character per box, a space where a box is empty: strip the spaces before
 * sending (OneTimeCode does). Six boxesRef for a 6-digit code (sign-up verification, sign-in MFA). Typing moves to the next
 * box, Backspace to the previous one, and a pasted code fills them all.
 */
export function CodeInput({
  label,
  value,
  onChange,
  disabled,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const boxesRef = useRef<(HTMLInputElement | null)[]>([]);
  // One character per box, a space for an empty box, so clearing one box never shifts the others.
  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('');
  const set = (i: number, digit: string) =>
    onChange(digits.map((d, k) => (k === i ? digit : d)).join(''));
  const focus = (i: number) => boxesRef.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();
  const put = (at: number, typed: string) => {
    const clean = typed.replace(/\D/g, '');
    if (!clean) return;
    const next = [...digits];
    clean
      .slice(0, LENGTH - at)
      .split('')
      .forEach((d, k) => (next[at + k] = d));
    onChange(next.join(''));
    focus(at + clean.length);
  };
  return (
    <fieldset aria-label={label} className="flex justify-center gap-2 md:gap-4">
      {SLOTS.map((slot, i) => {
        const digit = digits[i] ?? ' ';
        return (
          <input
            key={slot}
            ref={(el) => {
              boxesRef.current[i] = el;
            }}
            aria-label={`${label}, digit ${i + 1}`}
            aria-invalid={invalid || undefined}
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            inputMode="numeric"
            disabled={disabled}
            value={digit.trim()}
            onChange={(e) => {
              // Typing into a filled box adds to its digit: keep only what was typed.
              const typed = e.target.value;
              put(i, digit.trim() && typed.startsWith(digit) ? typed.slice(1) : typed);
            }}
            onPaste={(e) => {
              e.preventDefault();
              put(i, e.clipboardData.getData('text'));
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Backspace') return;
              e.preventDefault();
              if (digit.trim()) set(i, ' ');
              else if (i > 0) {
                set(i - 1, ' ');
                focus(i - 1);
              }
            }}
            className={`size-11 rounded-control border bg-surface text-center text-xl font-bold text-heading md:size-14 ${invalid ? 'border-danger' : 'border-border'}`}
          />
        );
      })}
    </fieldset>
  );
}
