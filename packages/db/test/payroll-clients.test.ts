// Payroll clients (r39_payroll_clients): firm-only rows tied to a PAYROLL engagement, a status
// that matches paused or archived, a provider connection that is the chosen provider's, and
// insert-only history and activity logs.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let pc = '';
const mk = (f = A, data: object = {}) =>
  as(f).payrollClient.create({
    data: { businessId: f.id, clientId: f.client, engagementId: f.eng, ...data } as never,
  });

beforeAll(async () => {
  await setup('PAYROLL');
  pc = (await mk()).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    expect(await as(B).payrollClient.findMany()).toEqual([]);
    expect(await as(B).payrollClientChange.findMany()).toEqual([]);
    expect(await as(B).payrollActivity.findMany()).toEqual([]);
    expect(await as(B).payrollSettings.findMany()).toEqual([]);
    expect(await outcome(mk(B, { engagementId: A.eng }))).toMatch(/Foreign key|PAYROLL_ENGAGEMENT/);
    const log = as(B).payrollActivity.create({
      data: {
        businessId: B.id,
        payrollClientId: pc,
        kind: 'OTHER',
        summary: 'x',
        loggedByUserId: B.owner,
      },
    });
    expect(await outcome(log)).toMatch(/Foreign key/);
  });
});

describe('payroll clients', () => {
  it('belong to one payroll engagement of their own client, once', async () => {
    expect(await outcome(mk())).toMatch(/Unique/i);
    const other = await as(A).service.create({
      data: { businessId: A.id, kind: 'BOOKKEEPING', name: 'Books' },
    });
    const eng = { businessId: A.id, clientId: A.client, serviceId: other.id, title: 'Books 2026' };
    const book = await as(A).engagement.create({ data: eng });
    expect(await outcome(mk(A, { engagementId: book.id }))).toMatch(/PAYROLL_ENGAGEMENT/);
  });
  it('keep status in step with pause and archive, and a date with its source', async () => {
    const set = (data: object) => outcome(as(A).payrollClient.update({ where: { id: pc }, data }));
    expect(await set({ status: 'ON_HOLD' })).toMatch(/payroll_clients_values/);
    expect(await set({ status: 'ON_HOLD', pausedAt: new Date() })).toBe('ok');
    expect(await set({ status: 'ON_TRACK', pausedAt: null })).toBe('ok');
    expect(await set({ nextPayrollOn: new Date('2026-09-19') })).toMatch(/payroll_clients_values/);
    expect(
      await set({ nextPayrollOn: new Date('2026-09-19'), nextPayrollSource: 'provider' }),
    ).toBe('ok');
    expect(await set({ employeeCount: 12 })).toMatch(/payroll_clients_values/);
    expect(await set({ clientId: B.client })).toMatch(/PAYROLL_FROZEN|Foreign key/);
  });
  it('use only the connection of the chosen provider', async () => {
    const conn = await as(A).integrationConnection.create({
      data: { businessId: A.id, provider: 'gusto' },
    });
    const set = (data: object) => outcome(as(A).payrollClient.update({ where: { id: pc }, data }));
    expect(await set({ connectionId: conn.id })).toMatch(/PAYROLL_CONNECTION/);
    expect(await set({ providerKey: 'adp', connectionId: conn.id })).toMatch(/PAYROLL_CONNECTION/);
    expect(await set({ providerKey: 'gusto', connectionId: conn.id })).toBe('ok');
  });
  it('are never deleted', async () => {
    expect(await outcome(as(A).payrollClient.delete({ where: { id: pc } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('history and activity', () => {
  it('are insert-only with checked values', async () => {
    const change = (d: object) =>
      outcome(
        as(A).payrollClientChange.create({
          data: { businessId: A.id, payrollClientId: pc, field: 'status', ...d },
        }),
      );
    expect(await change({ oldValue: 'ON_TRACK', newValue: 'PAST_DUE' })).toBe('ok');
    expect(await change({ oldValue: 'A', newValue: 'A' })).toMatch(/changes_values/);
    expect(await change({ field: 'Bad Field', newValue: 'x' })).toMatch(/changes_values/);
    expect(await outcome(as(A).payrollClientChange.updateMany({ data: { reason: 'x' } }))).toMatch(
      /permission denied/,
    );
    const log = {
      businessId: A.id,
      payrollClientId: pc,
      kind: 'CLIENT_CALL' as const,
      loggedByUserId: A.owner,
    };
    expect(
      await outcome(
        as(A).payrollActivity.create({ data: { ...log, summary: 'Called the owner' } }),
      ),
    ).toBe('ok');
    expect(
      await outcome(as(A).payrollActivity.create({ data: { ...log, summary: '  ' } })),
    ).toMatch(/activities_values/);
    expect(await outcome(as(A).payrollActivity.deleteMany())).toMatch(/permission denied/);
  });
  it('keep the module settings in range', async () => {
    const bad = as(A).payrollSettings.create({
      data: { businessId: A.id, reminderDaysBefore: 99 },
    });
    expect(await outcome(bad)).toMatch(/payroll_settings_values/);
  });
});
