// Unit tests for R12 step 3: which content kinds a portal client may read (System Wiring G).
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
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
