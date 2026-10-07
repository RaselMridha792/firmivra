import { z } from 'zod';

// Text rules shared by the R10 modules (the same as T02's settings contract; the lead moves both
// into one shared file once #38 is on main). Not exported from the package.

/** One line: no control characters (names end up in staff tasks and emails). */
const ONE_LINE = /^[^\p{Cc}]*$/u;
/** Several lines: tabs and line breaks only; Postgres text cannot hold NUL. */
const MULTI_LINE = /^(?:[^\p{Cc}]|[\t\n\r])*$/u;

/** Trimmed text of 1 to `max` characters, on one line or several. */
export const text = (max: number, lines: 'one' | 'many' = 'one', empty = 'Enter a value') =>
  z
    .string()
    .trim()
    .min(1, empty)
    .max(max, `Use at most ${max} characters`)
    .regex(lines === 'one' ? ONE_LINE : MULTI_LINE, 'Remove the special characters');

/** An optional field: leave it out to keep it; `null` or `''` clears it. */
export const clearable = <T>(value: z.ZodType<T, string>) =>
  z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : s))
    .pipe(value.nullable())
    .nullable()
    .optional();
