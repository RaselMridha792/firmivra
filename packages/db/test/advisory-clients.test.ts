// Advisory clients (r39_advisory_clients): firm-only rows tied to a business development
// engagement, a transparent health score, one primary service focus, and settings in range.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let ac = '';
const mk = (f = A, data: object = {}) =>
  as(f).advisoryClient.create({ data: { businessId: f.id, clientId: f.client, ...data } as never });
const stream = (serviceId: string, data: object = {}) =>
  as(A).advisoryWorkstream.create({
    data: { businessId: A.id, advisoryClientId: ac, serviceId, ...data } as never,
  });

beforeAll(async () => {
  await setup('BUSINESS_DEVELOPMENT');
  ac = (await mk(A, { engagementId: A.eng })).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    expect(await as(B).advisoryClient.findMany()).toEqual([]);
    expect(await as(B).advisoryWorkstream.findMany()).toEqual([]);
    expect(await as(B).advisorySettings.findMany()).toEqual([]);
    expect(await outcome(mk(B, { clientId: A.client }))).toMatch(/Foreign key|Unique/);
    const w = as(B).advisoryWorkstream.create({
      data: { businessId: B.id, advisoryClientId: ac, serviceId: B.service },
    });
    expect(await outcome(w)).toMatch(/Foreign key/);
  });
});

describe('advisory clients', () => {
  it('are one per client, with an advisory engagement only', async () => {
    expect(await outcome(mk())).toMatch(/Unique/i);
    const other = await as(A).service.create({
      data: { businessId: A.id, kind: 'BOOKKEEPING', name: 'Books' },
    });
    const e = { businessId: A.id, clientId: A.client, serviceId: other.id, title: 'Books' };
    const eng = await as(A).engagement.create({ data: e });
    const c2 = await as(A).client.create({ data: { businessId: A.id, displayName: 'Second' } });
    const wrong = as(A).advisoryClient.create({
      data: { businessId: A.id, clientId: A.client, engagementId: eng.id },
    });
    expect(await outcome(wrong)).toMatch(/Unique|ADVISORY_ENGAGEMENT/);
    expect(await outcome(mk(A, { clientId: c2.id, engagementId: A.eng }))).toMatch(
      /Foreign key|Unique/,
    );
  });
  it('keep the health score between 0 and 100 with the time it was calculated', async () => {
    const set = (data: object) => outcome(as(A).advisoryClient.update({ where: { id: ac }, data }));
    expect(await set({ healthScore: 82 })).toMatch(/advisory_clients_values/);
    expect(await set({ healthScore: 120, healthComputedAt: new Date() })).toMatch(
      /advisory_clients_values/,
    );
    expect(
      await set({
        healthScore: 82,
        healthComputedAt: new Date(),
        healthFactors: [{ factor: 'goals', weight: 40, value: 80 }],
      }),
    ).toBe('ok');
    expect(await set({ status: 'ARCHIVED' })).toMatch(/advisory_clients_values/);
    expect(await outcome(as(A).advisoryClient.delete({ where: { id: ac } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('workstreams', () => {
  it('have one service once and a single primary focus', async () => {
    const mkService = (name: string) =>
      as(A).service.create({ data: { businessId: A.id, kind: 'OTHER', name } });
    const [s1, s2] = [await mkService('Funding'), await mkService('Branding')];
    expect(await outcome(stream(s1.id, { role: 'PRIMARY' }))).toBe('ok');
    expect(await outcome(stream(s1.id))).toMatch(/Unique/i);
    expect(await outcome(stream(s2.id, { role: 'PRIMARY' }))).toMatch(/Unique/i);
    expect(await outcome(stream(s2.id, { status: 'PROPOSED' }))).toBe('ok');
    expect(
      await outcome(
        stream(s2.id, { startedOn: new Date('2026-02-01'), completedOn: new Date('2026-01-01') }),
      ),
    ).toMatch(/Unique|values/);
  });
  it('keep settings in range', async () => {
    const bad = as(A).advisorySettings.create({
      data: { businessId: A.id, staleFinancialsDays: 0 },
    });
    expect(await outcome(bad)).toMatch(/advisory_settings_values/);
  });
});
