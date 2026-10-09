// R10 step 7: the tax returns API's pure rules (apps/api/src/tax-returns/tax-return-rules.ts).
import type { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  canDelete,
  canMoveTo,
  changesOf,
  dateColumn,
  isoDate,
  needsFiledOn,
  type ReturnFields,
  refusalOf,
  toMyTaxReturn,
  toTaxReturn,
  visibleDocument,
} from '../../src/tax-returns/tax-return-rules.js';

const STATUSES = ['IN_PROGRESS', 'FILED', 'ACCEPTED', 'REJECTED', 'COMPLETED'] as const;
const clientId = '0199b6a1-0000-7000-8000-000000000001';
const otherClientId = '0199b6a1-0000-7000-8000-000000000002';
const docId = '0199b6a3-0000-7000-8000-000000000901';

const answer = (e: HttpException | undefined) =>
  e ? [e.getStatus(), (e.getResponse() as { code: string }).code] : undefined;

/** A Prisma error as the pg adapter reports it (meta.driverAdapterError.cause). */
const dbError = (originalCode: string, originalMessage: string) =>
  Object.assign(new Error('Database error'), {
    code: originalCode === '23503' ? 'P2003' : 'P2039',
    meta: { driverAdapterError: { cause: { originalCode, originalMessage } } },
  });

describe('status rules', () => {
  it('a FILED, ACCEPTED or COMPLETED return never goes back to IN_PROGRESS; REJECTED can', () => {
    const back = STATUSES.filter((from) => canMoveTo(from, 'IN_PROGRESS'));
    expect(back).toEqual(['IN_PROGRESS', 'REJECTED']);
    for (const from of STATUSES) {
      for (const to of STATUSES.filter((s) => s !== 'IN_PROGRESS')) {
        expect(canMoveTo(from, to), `${from} -> ${to}`).toBe(true);
      }
    }
  });

  it('FILED and ACCEPTED need a filed date', () => {
    expect(STATUSES.filter(needsFiledOn)).toEqual(['FILED', 'ACCEPTED']);
  });

  it('only a return that never left IN_PROGRESS can be deleted', () => {
    expect(canDelete({ status: 'IN_PROGRESS', firstFiledAt: null })).toBe(true);
    expect(canDelete({ status: 'IN_PROGRESS', firstFiledAt: new Date() })).toBe(false);
    for (const status of STATUSES.filter((s) => s !== 'IN_PROGRESS')) {
      expect(canDelete({ status, firstFiledAt: null }), status).toBe(false);
    }
  });
});

describe('changesOf', () => {
  const current: ReturnFields = {
    taxYear: 2024,
    filingType: 'INDIVIDUAL',
    quarter: 2,
    formType: '1040-ES',
    status: 'IN_PROGRESS',
    filedOn: null,
    engagementId: null,
    documentId: docId,
  };

  it('keeps only the fields sent with a different value; null clears', () => {
    expect(
      changesOf(current, {
        taxYear: 2024,
        quarter: null,
        formType: '1040-ES',
        status: 'FILED',
        filedOn: '2025-04-15',
        documentId: null,
        engagementId: undefined,
      }),
    ).toEqual({ quarter: null, status: 'FILED', filedOn: '2025-04-15', documentId: null });
  });

  it('a change that changes nothing is empty', () => {
    expect(changesOf(current, { ...current })).toEqual({});
    expect(changesOf(current, {})).toEqual({});
  });
});

describe('shapes', () => {
  const row = {
    id: '0199b6a3-0000-7000-8000-000000000001',
    clientId,
    engagementId: null,
    taxYear: 2024,
    filingType: 'INDIVIDUAL' as const,
    quarter: null,
    formType: '1040',
    status: 'FILED' as const,
    filedOn: dateColumn('2025-04-12'),
    documentId: docId,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-02T09:00:00.000Z'),
  };

  it('dates are calendar days in and out', () => {
    expect(isoDate(dateColumn('2025-04-12'))).toBe('2025-04-12');
    expect(dateColumn('2025-04-12').toISOString()).toBe('2025-04-12T00:00:00.000Z');
  });

  it('the firm sees the return and its PDF whatever the scan', () => {
    expect(toTaxReturn({ ...row, document: { id: docId, fileName: 'Fake.pdf' } })).toEqual({
      id: row.id,
      clientId,
      engagementId: null,
      taxYear: 2024,
      filingType: 'INDIVIDUAL',
      quarter: null,
      formType: '1040',
      status: 'FILED',
      filedOn: '2025-04-12',
      document: { id: docId, fileName: 'Fake.pdf' },
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    });
  });

  it('the client sees no client or engagement id, and the PDF only when CLEAN and shared', () => {
    const doc = {
      id: docId,
      fileName: 'Fake.pdf',
      clientId,
      direction: 'FIRM_TO_CLIENT',
      scanStatus: 'CLEAN',
    };
    const mine = toMyTaxReturn({ ...row, document: doc }, clientId);
    expect(Object.keys(mine).sort()).toEqual(
      [
        'document',
        'filedOn',
        'filingType',
        'formType',
        'id',
        'quarter',
        'status',
        'taxYear',
      ].sort(),
    );
    expect(mine.document).toEqual({ id: docId, fileName: 'Fake.pdf' });
    expect(visibleDocument({ ...doc, direction: 'CLIENT_TO_FIRM' }, clientId)).toEqual({
      id: docId,
      fileName: 'Fake.pdf',
    });
    for (const hidden of [
      { ...doc, scanStatus: 'PENDING' },
      { ...doc, scanStatus: 'INFECTED' },
      { ...doc, scanStatus: 'FAILED' },
      { ...doc, direction: 'INTERNAL' },
      { ...doc, clientId: otherClientId },
    ]) {
      expect(visibleDocument(hidden, clientId), JSON.stringify(hidden)).toBeNull();
    }
    expect(visibleDocument(null, clientId)).toBeNull();
  });
});

describe('refusalOf: the database backstop', () => {
  it("answers the database's refusals with the API's codes", () => {
    const cases: [string, string, unknown[]][] = [
      [
        '23503',
        'insert or update on table "tax_returns" violates foreign key constraint "tax_returns_business_id_client_id_engagement_id_fkey"',
        [404, 'NOT_FOUND'],
      ],
      [
        '23514',
        "tax returns: the return document must be one of this client's documents, not an internal one",
        [409, 'INVALID_DOCUMENT'],
      ],
      ['23514', 'tax returns: filed_on cannot be in the future', [400, 'VALIDATION_FAILED']],
      [
        '23514',
        'new row for relation "tax_returns" violates check constraint "tax_returns_filed_on"',
        [400, 'VALIDATION_FAILED'],
      ],
      [
        '23514',
        'new row for relation "tax_returns" violates check constraint "tax_returns_quarter"',
        [400, 'VALIDATION_FAILED'],
      ],
    ];
    for (const [code, message, expected] of cases) {
      expect(answer(refusalOf(dbError(code, message))), message).toEqual(expected);
    }
    const filedOn = refusalOf(
      dbError(
        '23514',
        'new row for relation "tax_returns" violates check constraint "tax_returns_filed_on"',
      ),
    );
    expect((filedOn?.getResponse() as { details: unknown }).details).toEqual([
      { path: 'filedOn', message: 'Enter the date it was filed' },
    ]);
  });

  it('leaves anything else alone (a 500 shows a bug)', () => {
    for (const error of [
      dbError('23514', 'tax returns: a return cannot change client'),
      dbError('23514', 'new row for relation "clients" violates check constraint "clients_x"'),
      dbError('40P01', 'deadlock detected'),
      new Error('plain'),
      null,
      { code: 'P2002' },
    ]) {
      expect(refusalOf(error)).toBeUndefined();
    }
  });
});
