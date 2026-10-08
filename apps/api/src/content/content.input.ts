import {
  ContentQuery,
  CreateContentRequest,
  MyContentQuery,
  UpdateContentRequest,
} from '@firmivra/types';
import type { z } from 'zod';

// The contract's schemas, plus what Postgres text cannot hold: a NUL character, or half of a
// UTF-16 surrogate pair ("\ud800" in JSON). Either one reaches the driver as an encoding error,
// so the API refuses it as 400 VALIDATION_FAILED instead of answering 500. Query filters also
// refuse every other control character, as the contract's one-line text does.

/** A lone surrogate: a pair is one astral code point in a `u` regex, never `Cs`. */
const LONE_SURROGATE = /\p{Cs}/u;
const CONTROL_OR_SURROGATE = /[\p{Cc}\p{Cs}]/u;

const refuse = (bad: RegExp) => (values: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && bad.test(value)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Remove the special characters' });
    }
  }
};

/** GET /business/content */
export const ListQuery = ContentQuery.superRefine(refuse(CONTROL_OR_SURROGATE));
/** GET /portal/{firmSlug}/me/content */
export const MyListQuery = MyContentQuery.superRefine(refuse(CONTROL_OR_SURROGATE));
/** POST /business/content */
export const CreateBody = CreateContentRequest.superRefine(refuse(LONE_SURROGATE));
/** PATCH /business/content/{id} */
export const UpdateBody = UpdateContentRequest.superRefine(refuse(LONE_SURROGATE));
