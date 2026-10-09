import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ANNUAL_TAX_FORM, restoreMaskedNumbers } from '@firmivra/types';
import {
  FieldEncryption,
  FieldEncryptionError,
} from '../../src/field-encryption/field-encryption.service.js';
import { LocalKeyWrapper } from '../../src/field-encryption/key-wrapper.js';
import {
  MAX_SEALED_NUMBERS_PER_SAVE,
  maskStoredNumbers,
  numberField,
  sealIntakeNumbers,
} from '../../src/intake/intake-numbers.js';

// A stand-in that records each field context and refuses a field name the real cipher refuses
// (field-encryption.service.ts); the real cipher has its own tests.
const contexts: string[] = [];
const fe = {
  encrypt: async (ctx: { recordId: string; field: string }, value: string) => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(ctx.field)) throw new Error('INVALID_CONTEXT');
    contexts.push(`${ctx.recordId}:${ctx.field}`);
    return new Uint8Array(Buffer.from(`enc(${value})`));
  },
} as unknown as FieldEncryption;
type Values = Record<string, unknown>;
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
    expect(contexts).toEqual([`${where.intakeId}:${numberField('ssn')}`]);

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

  it('seals a spouse SSN and SSNs in group rows, each bound to its own path', async () => {
    contexts.length = 0;
    const sealed = await sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      {
        spouseSsn: '987-65-4321',
        dependents: [
          { id: 'a1', firstName: 'Kid', ssn: '111-22-3333' },
          { id: 'b2', firstName: 'Kid', ssn: '444-55-6666' },
        ],
      },
      {},
    );
    expect(sealed['spouseSsn']).toMatchObject({ last4: '4321' });
    expect(sealed['dependents']).toMatchObject([
      { id: 'a1', ssn: { last4: '3333' } },
      { id: 'b2', ssn: { last4: '6666' } },
    ]);
    expect(new Set(contexts).size).toBe(3);
    expect(numberField('dependents.a1.ssn')).not.toBe(numberField('dependents.b2.ssn'));
  });

  it('passes null through, seals a matching plain stored number, and refuses anything else', async () => {
    contexts.length = 0;
    const cleared = await sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      { ssn: null, spouseSsn: undefined },
      {},
    );
    expect(cleared).toEqual({ ssn: null, spouseSsn: undefined });

    const legacy = await sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      { ssn: { last4: '6789' } },
      { ssn: '123456789' },
    );
    expect(legacy['ssn']).toEqual({
      last4: '6789',
      sealed: Buffer.from('enc(123456789)').toString('base64'),
    });
    expect(contexts).toEqual([`${where.intakeId}:${numberField('ssn')}`]);

    const sealedSsn = legacy['ssn'];
    const refused: [unknown, unknown][] = [
      [{ last4: '6789' }, undefined], // nothing stored
      [{ last4: '0000' }, sealedSsn], // another last4 than the sealed one
      [{ last4: '0000' }, '123456789'], // another last4 than the plain one
      [{ last4: '6789' }, { last4: '6789' }], // stored without its sealed value
      [{ last4: '6789', sealed: 'AAAA' }, sealedSsn], // a blob from the request
      [123456789, undefined],
      [['123456789'], undefined],
    ];
    for (const [value, stored] of refused) {
      await expect(
        sealIntakeNumbers(fe, where, ANNUAL_TAX_FORM, { ssn: value }, { ssn: stored }),
      ).rejects.toThrow('Intake answer ssn is not a number');
    }
    const row = sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      { dependents: [{ id: 'a1', ssn: { last4: '3333' } }] },
      { dependents: [{ id: 'a1', ssn: { last4: '3333' } }] },
    );
    await expect(row).rejects.toThrow('Intake answer dependents.a1.ssn');
  });

  it(`refuses a save with more than ${MAX_SEALED_NUMBERS_PER_SAVE} new numbers before sealing any`, async () => {
    const rows = (n: number, key: 'ssn' | 'ein') =>
      Array.from({ length: n }, (_, i) => ({ id: `r${i}`, [key]: String(100000000 + i) }));
    // The most Annual Tax allows: two at the top, 50 dependents and 50 businesses.
    contexts.length = 0;
    const most = await sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      {
        ssn: '123456789',
        spouseSsn: '987654321',
        dependents: rows(50, 'ssn'),
        businesses: rows(50, 'ein'),
      },
      {},
    );
    expect(contexts).toHaveLength(102);
    expect(MAX_SEALED_NUMBERS_PER_SAVE).toBeGreaterThanOrEqual(102);
    // Sealed in parallel, but each result stays at its own row.
    expect((most['dependents'] as { ssn: unknown }[])[49]?.ssn).toMatchObject({ last4: '0049' });
    expect((most['businesses'] as { ein: unknown }[])[7]?.ein).toMatchObject({ last4: '0007' });

    contexts.length = 0;
    const over = await sealIntakeNumbers(
      fe,
      where,
      ANNUAL_TAX_FORM,
      { dependents: rows(MAX_SEALED_NUMBERS_PER_SAVE + 1, 'ssn') },
      {},
    ).catch((e: unknown) => e);
    expect(over).toBeInstanceOf(HttpException);
    expect((over as HttpException).getResponse()).toMatchObject({ code: 'TOO_MANY_NUMBERS' });
    expect(contexts).toEqual([]);
  });

  it('never returns a sealed blob, even under a key the definition does not list as a number', async () => {
    const stray = { last4: '6789', sealed: 'c2VjcmV0' };
    const masked = await maskStoredNumbers(ANNUAL_TAX_FORM, {
      ssn: stray,
      oldTaxId: stray,
      dependents: [{ id: 'a1', ssn: stray, oldSsn: stray, notes: [{ inner: stray }] }],
      otherRows: [{ id: 'x', ein: stray }],
    });
    expect(masked['oldTaxId']).toEqual({ last4: '6789' });
    expect(masked['otherRows']).toEqual([{ id: 'x', ein: { last4: '6789' } }]);
    expect(JSON.stringify(masked)).not.toContain('sealed');
    expect(JSON.stringify(masked)).not.toContain('c2VjcmV0');
  });

  it('with the real cipher, a sealed number opens only at its own path and intake', async () => {
    const real = new FieldEncryption(new LocalKeyWrapper(randomBytes(32)), {
      keyIdOf: async () => null,
    });
    const sealed = await sealIntakeNumbers(
      real,
      where,
      ANNUAL_TAX_FORM,
      { ssn: '123-45-6789', dependents: [{ id: 'a1', ssn: '111-22-3333' }] },
      {},
    );
    const blob = (path: string) => {
      const v = path === 'ssn' ? sealed['ssn'] : (sealed['dependents'] as Values[])[0]?.['ssn'];
      return new Uint8Array(Buffer.from((v as { sealed: string }).sealed, 'base64'));
    };
    const open = (path: string, at: string, recordId = where.intakeId) =>
      real.decrypt(
        {
          businessId: where.businessId,
          table: 'intake_submissions',
          recordId,
          field: numberField(at),
        },
        blob(path),
      );
    await expect(open('ssn', 'ssn')).resolves.toBe('123-45-6789');
    await expect(open('dependents.a1.ssn', 'dependents.a1.ssn')).resolves.toBe('111-22-3333');
    const otherIntake = '0199b6a0-0000-7000-8000-0000000000bb';
    for (const attempt of [
      open('ssn', 'spouseSsn'),
      open('ssn', 'dependents.a1.ssn'),
      open('dependents.a1.ssn', 'ssn'),
      open('ssn', 'ssn', otherIntake),
    ]) {
      const error = await attempt.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FieldEncryptionError);
      expect((error as FieldEncryptionError).code).toBe('DECRYPTION_FAILED');
    }
  });
});
