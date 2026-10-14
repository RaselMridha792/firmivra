// Saved reports (r39_reports): definitions, shares, favourites and settings are firm-only; a
// definition has a fixed or rolling date rule, safe field names and valid sharing.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let report = '';
const make = (f = A, data: object = {}) =>
  as(f).reportDefinition.create({
    data: {
      businessId: f.id,
      category: 'FINANCIAL',
      dataSource: 'invoices_payments',
      name: 'Revenue',
      columns: ['client_name', 'amount'],
      datePreset: 'this_year',
      ownerUserId: f.owner,
      ...data,
    } as never,
  });

beforeAll(async () => {
  await setup();
  report = (await make()).id;
  const link = { businessId: A.id, definitionId: report, userId: A.owner };
  await as(A).reportShare.create({ data: link });
  await as(A).reportFavorite.create({ data: link });
  await as(A).reportSettings.create({ data: { businessId: A.id } });
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    expect(await as(B).reportDefinition.findMany()).toEqual([]);
    expect(await as(B).reportShare.findMany()).toEqual([]);
    expect(await as(B).reportFavorite.findMany()).toEqual([]);
    expect(await as(B).reportSettings.findMany()).toEqual([]);
    const fav = as(B).reportFavorite.create({
      data: { businessId: B.id, definitionId: report, userId: B.owner },
    });
    expect(await outcome(fav)).toMatch(/Foreign key/);
    expect(await outcome(as(B).reportSettings.create({ data: { businessId: A.id } }))).toMatch(
      /row-level security/,
    );
  });
});

describe('definitions', () => {
  it('have a fixed range with both dates, or a rolling preset', async () => {
    const fixed = {
      dateRule: 'FIXED',
      datePreset: null,
      dateFrom: new Date('2026-01-01'),
      dateTo: new Date('2026-09-20'),
    };
    expect(await outcome(make(A, fixed))).toBe('ok');
    expect(await outcome(make(A, { ...fixed, dateTo: new Date('2025-01-01') }))).toMatch(
      /report_definitions_values/,
    );
    expect(await outcome(make(A, { dateRule: 'FIXED', datePreset: null }))).toMatch(
      /report_definitions_values/,
    );
    expect(await outcome(make(A, { datePreset: null }))).toMatch(/report_definitions_values/);
  });
  it('refuse sensitive or malformed field names', async () => {
    for (const columns of [
      ['ssn'],
      ['client.bank_account_number'],
      ['Client Name'],
      ['password_hash'],
    ]) {
      expect(await outcome(make(A, { columns }))).toMatch(/report_definitions_values/);
    }
  });
  it('need a comparison kind to compare, and a chart that exists', async () => {
    expect(await outcome(make(A, { includeComparison: true }))).toMatch(
      /report_definitions_values/,
    );
    expect(await outcome(make(A, { includeComparison: true, compareTo: 'previous_period' }))).toBe(
      'ok',
    );
    expect(await outcome(make(A, { chartType: 'pie3d' }))).toMatch(/report_definitions_values/);
  });
  it('share roles only when selected, and only with firm members', async () => {
    expect(await outcome(make(A, { sharedRoles: ['STAFF'] }))).toMatch(/report_definitions_values/);
    expect(
      await outcome(make(A, { visibility: 'SELECTED', sharedRoles: ['STAFF', 'BOSS'] })),
    ).toMatch(/report_definitions_values/);
    expect(await outcome(make(A, { visibility: 'SELECTED', sharedRoles: ['STAFF'] }))).toBe('ok');
    const stranger = as(A).reportShare.create({
      data: { businessId: A.id, definitionId: report, userId: B.owner },
    });
    expect(await outcome(stranger)).toMatch(/REPORT_SHARE_MEMBER/);
  });
  it('are never deleted, and settings stay in range', async () => {
    expect(await outcome(as(A).reportDefinition.delete({ where: { id: report } }))).toMatch(
      /permission denied/,
    );
    expect(
      await outcome(
        as(A).reportSettings.update({
          where: { businessId: A.id },
          data: { staleAfterMinutes: 0 },
        }),
      ),
    ).toMatch(/report_settings_values/);
  });
});
