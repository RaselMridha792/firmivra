import {
  ConsentQuery,
  CreateSegmentRequest,
  PreviewSegmentRequest,
  SegmentMembersQuery,
  SegmentsQuery,
  SetConsentRequest,
  SetSegmentMembersRequest,
  UpdateSegmentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED: a NUL
// character or half of a surrogate pair in any string, and a date in the year 0000.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    const walk = (v: unknown, path: (string | number)[]): void => {
      if (typeof v === 'string' && /^0000-/.test(v)) {
        ctx.addIssue({ code: 'custom', path, message: 'Use a real date' });
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
      else if (typeof v === 'object' && v !== null)
        Object.entries(v).forEach(([k, x]) => walk(x, [...path, k]));
    };
    walk(value, []);
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const SegmentsQ = clean(SegmentsQuery);
export const CreateSegmentBody = clean(CreateSegmentRequest);
export const UpdateSegmentBody = clean(UpdateSegmentRequest);
export const PreviewSegmentBody = clean(PreviewSegmentRequest);
export const SegmentMembersQ = clean(SegmentMembersQuery);
export const SetSegmentMembersBody = clean(SetSegmentMembersRequest);
export const SetConsentBody = clean(SetConsentRequest);
export const ConsentQ = clean(ConsentQuery);
