// Bookkeeping Terms (R55): the database's refusals become the contract's errors, never a 500.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BookkeepingTermsService } from '../../src/bookkeeping/bookkeeping-terms.service.js';

const service = new BookkeepingTermsService({} as never, {} as never);
const mapped = (e: unknown) => {
  try {
    (service as unknown as { mapError(e: unknown): never }).mapError(e);
  } catch (out) {
    return out;
  }
  throw new Error('mapError returned');
};
const dbError = (code: string, message: string) =>
  Object.assign(new Error(`Database error. Code: \`${code}\`. Message: \`${message}\``), {
    code: 'P2010',
    // As Prisma's driver adapter reports a Postgres error.
    meta: { driverAdapterError: { cause: { originalCode: code, originalMessage: message } } },
  });

describe('BookkeepingTermsService errors', () => {
  it.each([
    'bookkeeping: only draft terms are edited; create a new version',
    'bookkeeping: ACTIVE terms cannot become DRAFT',
    'bookkeeping: SUPERSEDED terms never change',
  ])('turns "%s" into 409 TERMS_STATE', (message) => {
    const out = mapped(dbError('23514', message));
    expect(out).toBeInstanceOf(ConflictException);
    expect((out as ConflictException).getResponse()).toMatchObject({ code: 'TERMS_STATE' });
  });

  it('turns a foreign key refusal into 409 NOT_THIS_CLIENTS, and another check into 400', () => {
    expect((mapped({ code: 'P2003' }) as ConflictException).getResponse()).toMatchObject({
      code: 'NOT_THIS_CLIENTS',
    });
    expect(mapped(dbError('23514', 'new row violates check constraint "x"'))).toBeInstanceOf(
      BadRequestException,
    );
  });

  it('passes anything else on', () => {
    const e = new Error('boom');
    expect(mapped(e)).toBe(e);
  });
});
