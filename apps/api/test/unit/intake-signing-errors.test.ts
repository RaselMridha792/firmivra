// The database's refusal of a signature row becomes the contract's answer, never a 500 (R14).
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { signingRefusal } from '../../src/agreements/intake-signatures.service.js';

/** A Prisma error from the pg adapter, as the driver reports a database error. */
const dbError = (originalCode: string, originalMessage: string) =>
  Object.assign(new Error('Database error'), {
    meta: { driverAdapterError: { cause: { originalCode, originalMessage } } },
  });

describe('signingRefusal', () => {
  it('maps the typed-matches check to 400 SIGNATURE_MISMATCH', () => {
    const refusal = signingRefusal(
      dbError(
        '23514',
        'new row for relation "intake_signatures" violates check constraint "intake_signatures_typed_matches"',
      ),
    );
    expect(refusal).toBeInstanceOf(BadRequestException);
    expect(refusal?.getResponse()).toMatchObject({ code: 'SIGNATURE_MISMATCH' });
  });

  it('leaves other errors alone', () => {
    expect(
      signingRefusal(dbError('23514', 'violates check constraint "intake_signatures_title"')),
    ).toBeUndefined();
    expect(
      signingRefusal(dbError('23505', 'intake_signatures_typed_matches (not a check)')),
    ).toBeUndefined();
    expect(signingRefusal(new Error('intake_signatures_typed_matches'))).toBeUndefined();
    expect(signingRefusal(null)).toBeUndefined();
  });
});
