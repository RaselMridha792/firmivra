import { z } from 'zod';

// Text rules shared by the R10 modules (the same as T02's settings contract; the lead moves both
// into one shared file once #38 is on main). Not exported from the package.

/*
 * Both rules refuse the invisible and direction-changing characters that disguise text in staff
 * tasks and emails (a right-to-left override, a zero-width space): U+061C, U+200B, U+202A to
 * U+202E, U+2060, U+2066 to U+2069 and U+FEFF. Other format characters stay allowed, since real
 * names and notes need them: the zero-width non-joiner and joiner (U+200C, U+200D: Persian and
 * Indic spelling, emoji sequences), the soft hyphen (U+00AD) and the left-to-right and
 * right-to-left marks (U+200E, U+200F).
 */

/** One line: none of those, no control characters, no line or paragraph separators. */
const ONE_LINE = /^[^\p{Cc}\p{Zl}\p{Zp}\u061C\u200B\u202A-\u202E\u2060\u2066-\u2069\uFEFF]*$/u;
/**
 * Several lines: none of those, and no control characters but tab, line feed and carriage
 * return (Postgres text cannot hold NUL); line and paragraph separators are allowed.
 */
const MULTI_LINE = /^(?:[^\p{Cc}\u061C\u200B\u202A-\u202E\u2060\u2066-\u2069\uFEFF]|[\t\n\r])*$/u;

/** Trimmed text of 1 to `max` characters, on one line or several. */
export const text = (max: number, lines: 'one' | 'many' = 'one', empty = 'Enter a value') =>
  z
    .string()
    .trim()
    .min(1, empty)
    .max(max, `Use at most ${max} characters`)
    .regex(lines === 'one' ? ONE_LINE : MULTI_LINE, 'Remove the special characters');

/**
 * A list's search box: trimmed, at most 100 characters, empty allowed. No control characters
 * (Postgres text cannot hold NUL, which answered 500) and no lone surrogates (half of an emoji,
 * not text), so a pasted or crafted search is 400 with this message instead.
 */
export const SearchText = z
  .string()
  .trim()
  .max(100, 'Use at most 100 characters')
  .regex(/^[^\p{Cc}\p{Cs}]*$/u, 'Remove the special characters');

/** An optional field: leave it out to keep it; `null` or `''` clears it. */
export const clearable = <T>(value: z.ZodType<T, string>) =>
  z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : s))
    .pipe(value.nullable())
    .nullable()
    .optional();
