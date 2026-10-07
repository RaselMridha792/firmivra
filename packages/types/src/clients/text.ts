import { z } from 'zod';

// Text rules shared by the R10 modules (the same as T02's settings contract; the lead moves both
// into one shared file once #38 is on main). Not exported from the package.

/**
 * One line: no control or format characters (a right-to-left override or a zero-width space
 * would disguise a name in staff tasks and emails), and no line or paragraph separators.
 */
const ONE_LINE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
/** Several lines: tabs and line breaks only, no format characters; Postgres text cannot hold NUL. */
const MULTI_LINE = /^(?:[^\p{Cc}\p{Cf}]|[\t\n\r])*$/u;

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
