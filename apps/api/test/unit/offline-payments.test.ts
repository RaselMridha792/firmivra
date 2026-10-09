// R7: the database's offline payment refusals (R0's FV codes) as the contract's answers.
import { describe, expect, it } from 'vitest';
import { DB_ERRORS } from '@firmivra/db';
import { mapped } from '../../src/payments/offline/offline-payments.service.js';

/** A Prisma error as the pg adapter raises it for a PL/pgSQL RAISE with an SQLSTATE. */
const dbError = (code: string) => ({
  name: 'PrismaClientKnownRequestError',
  meta: { driverAdapterError: { cause: { originalCode: code } } },
});

describe('offline payments: mapped database errors', () => {
  it('answers FV002 (not an active Owner or Admin any more) 403 FORBIDDEN', () => {
    expect(mapped(dbError(DB_ERRORS.NOT_FIRM_MANAGER))).toMatchObject({
      status: 403,
      response: { code: 'FORBIDDEN' },
    });
  });

  it('answers FV003 (over the balance) 409 AMOUNT_TOO_LARGE', () => {
    expect(mapped(dbError(DB_ERRORS.OVER_BALANCE))).toMatchObject({
      status: 409,
      response: { code: 'AMOUNT_TOO_LARGE' },
    });
  });

  it('answers FV004 (a checkout is open) 409 PAYMENT_IN_PROGRESS', () => {
    expect(mapped(dbError(DB_ERRORS.PAYMENT_IN_PROGRESS))).toMatchObject({
      status: 409,
      response: { code: 'PAYMENT_IN_PROGRESS' },
    });
  });

  it('leaves any other error as it is', () => {
    const other = dbError('23503');
    expect(mapped(other)).toBe(other);
  });
});
