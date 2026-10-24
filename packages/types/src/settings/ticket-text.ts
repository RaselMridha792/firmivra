import { text } from '../clients/text.js';

// Text a firm sends into a support ticket (Company Profile's Request Change, Billing's requests).
// Not exported from the package.

/** Refused by the support tickets' check but not by `text`: the soft hyphen, U+034F, U+17B4,
 * U+17B5 and the line and paragraph separators. */
const TICKET_REFUSED = new Set([0xad, 0x34f, 0x17b4, 0x17b5, 0x2028, 0x2029]);
/** What that check counts as blank: spaces, the invisible spaces and the variation selectors. */
const blank = (c: string) => {
  const cp = c.codePointAt(0) ?? 0;
  return (
    /\s/.test(c) ||
    [0xa0, 0x1680, 0x202f, 0x205f, 0x2800, 0x3000].includes(cp) ||
    (cp >= 0x2000 && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  );
};

/**
 * `text`, with the support tickets' own check (`platform_text_ok`), so such a value is a 400 here
 * rather than a database error: none of those characters, and one visible character.
 */
export const ticketText = (max: number, lines: 'one' | 'many' = 'one', empty = 'Enter a value') =>
  text(max, lines, empty)
    .refine(
      (v) => ![...v].some((c) => TICKET_REFUSED.has(c.codePointAt(0) ?? 0)),
      'Remove the special characters',
    )
    .refine((v) => [...v].some((c) => !blank(c)), empty);
