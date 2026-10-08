import { UpdateCalculatorRequest } from '@firmivra/types';
import type { z } from 'zod';

// The contract's schema, plus what UTF-8 (so Postgres text) cannot hold: half of a UTF-16
// surrogate pair ("\ud800" in JSON). The driver would store it as U+FFFD without an error, so the
// saved title or disclaimer would differ from what was sent; the API refuses it as 400
// VALIDATION_FAILED instead. (The contract's text rule already refuses NUL and the other control
// characters.)

/** A lone surrogate: a pair is one astral code point in a `u` regex, never `Cs`. */
const LONE_SURROGATE = /\p{Cs}/u;

/** PATCH /business/calculators/{key} */
export const UpdateBody = UpdateCalculatorRequest.superRefine((values, ctx) => {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && LONE_SURROGATE.test(value)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Remove the special characters' });
    }
  }
});
export type UpdateBody = z.output<typeof UpdateBody>;
