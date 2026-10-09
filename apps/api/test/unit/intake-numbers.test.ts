import { describe, expect, it } from 'vitest';
import { ANNUAL_TAX_FORM, restoreMaskedNumbers } from '@firmivra/types';
import type { FieldEncryption } from '../../src/field-encryption/field-encryption.service.js';
import { maskStoredNumbers, sealIntakeNumbers } from '../../src/intake/intake-numbers.js';

// A stand-in that records each field context; the real cipher has its own tests.
const contexts: string[] = [];
const fe = {
  encrypt: async (ctx: { recordId: string; field: string }, value: string) => {
    contexts.push(`${ctx.recordId}:${ctx.field}`);
    return new Uint8Array(Buffer.from(`enc(${value})`));
  },
} as unknown as FieldEncryption;
const where = {
  businessId: '0199b6a0-0000-7000-8000-000000000001',
  intakeId: '0199b6a0-0000-7000-8000-0000000000aa',
};

describe('intake numbers at rest', () => {
  it('seals full numbers, keeps the stored one for an unchanged { last4 }, never returns the blob', async () => {
    const first = await sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      { ssn: '123-45-6789', firstName: 'Avery' },
      {},
    );
    expect(first['ssn']).toEqual({
      last4: '6789',
      sealed: Buffer.from('enc(123-45-6789)').toString('base64'),
    });
    expect(first['firstName']).toBe('Avery');
    expect(contexts).toEqual([`${where.intakeId}:ssn`]);

    const masked = await maskStoredNumbers(ANNUAL_TAX_FORM, first);
    expect(masked['ssn']).toEqual({ last4: '6789' });
    expect(JSON.stringify(masked)).not.toContain('sealed');

    const again = restoreMaskedNumbers(ANNUAL_TAX_FORM, { ssn: { last4: '6789' } }, masked);
    expect(again.issues).toEqual([]);
    const kept = await sealIntakeNumbers(fe, where, ANNUAL_TAX_FORM, again.answers, first);
    expect(kept['ssn']).toBe(first['ssn']);
    expect(contexts).toHaveLength(1);
  });

  it('a { last4 } that is not the stored number is an issue before sealing', async () => {
    const first = await sealIntakeNumbers(fe, where, ANNUAL_TAX_FORM, { ssn: '123-45-6789' }, {});
    const result = restoreMaskedNumbers(
      ANNUAL_TAX_FORM,
      { ssn: { last4: '0000' } },
      await maskStoredNumbers(ANNUAL_TAX_FORM, first),
    );
    expect(result.issues.map((i) => i.path)).toEqual([['ssn']]);
  });
});
