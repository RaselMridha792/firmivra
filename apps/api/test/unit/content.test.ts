// Unit tests for R12 step 3: which content kinds a portal client may read (System Wiring G).
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateBody, ListQuery, MyListQuery, UpdateBody } from '../../src/content/content.input.js';
import { readableKinds } from '../../src/content/content.service.js';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return ((e as ForbiddenException).getResponse() as { code: string }).code;
  }
  return null;
};

describe('the API input schemas', () => {
  const tip = { kind: 'TIP', title: 'Tip (fake)', body: 'Text' };

  it('refuse half a surrogate pair in any text, and keep whole pairs (emoji)', () => {
    expect(CreateBody.safeParse({ ...tip, title: 'Tip 😀' }).success).toBe(true);
    for (const field of ['title', 'body', 'category', 'description']) {
      const res = CreateBody.safeParse({ ...tip, [field]: 'x \ud800 y' });
      expect(res.success, field).toBe(false);
      expect(
        res.error?.issues.map((i) => i.path.join('.')),
        field,
      ).toContain(field);
    }
    expect(UpdateBody.safeParse({ body: 'x \udfff' }).success).toBe(false);
    expect(UpdateBody.safeParse({ body: 'x 😀' }).success).toBe(true);
  });

  it('refuse NUL and other control characters in query filters', () => {
    for (const schema of [ListQuery, MyListQuery]) {
      expect(schema.safeParse({ category: 'payroll' }).success).toBe(true);
      expect(schema.safeParse({ category: 'a\u0000b' }).success).toBe(false);
      expect(schema.safeParse({ category: 'a\u0001b' }).success).toBe(false);
      expect(schema.safeParse({ category: 'a\ud800' }).success).toBe(false);
    }
  });
});

describe('readableKinds', () => {
  it('a business client reads every kind, or the one asked for', () => {
    expect(readableKinds('BUSINESS', undefined)).toEqual(['RESOURCE', 'TIP', 'EXTERNAL_LINK']);
    expect(readableKinds('BUSINESS', 'RESOURCE')).toEqual(['RESOURCE']);
    expect(readableKinds('BUSINESS', 'EXTERNAL_LINK')).toEqual(['EXTERNAL_LINK']);
    expect(readableKinds('BUSINESS', 'TIP')).toEqual(['TIP']);
  });

  it('an individual (or a login without a client record) reads tips only', () => {
    for (const type of ['INDIVIDUAL', null] as const) {
      expect(readableKinds(type, undefined)).toEqual(['TIP']);
      expect(readableKinds(type, 'TIP')).toEqual(['TIP']);
      expect(codeOf(() => readableKinds(type, 'RESOURCE'))).toBe('BUSINESS_ONLY');
      expect(codeOf(() => readableKinds(type, 'EXTERNAL_LINK'))).toBe('BUSINESS_ONLY');
    }
  });
});
