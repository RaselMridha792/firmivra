// Integrations (r39_integrations): connection records are firm-only, hold no secret (only a
// reference), and finished sync runs never change.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let conn = '';
const connect = (f = A, data: object = {}) =>
  as(f).integrationConnection.create({
    data: { businessId: f.id, provider: 'quickbooks_online', ...data },
  });

beforeAll(async () => {
  await setup();
  conn = (await connect(A, { secretRef: 'firmivra/dev/a/quickbooks', entities: ['invoices'] })).id;
  await as(A).integrationFieldMapping.create({
    data: {
      businessId: A.id,
      connectionId: conn,
      scope: 'client',
      localField: 'name',
      externalField: 'Customer Name',
    },
  });
  await as(A).integrationSyncRun.create({
    data: { businessId: A.id, connectionId: conn, entity: 'invoices' },
  });
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    const b = as(B);
    expect(await b.integrationConnection.findMany()).toEqual([]);
    expect(await b.integrationFieldMapping.findMany()).toEqual([]);
    expect(await b.integrationSyncRun.findMany()).toEqual([]);
    const run = b.integrationSyncRun.create({
      data: { businessId: B.id, connectionId: conn, entity: 'x' },
    });
    expect(await outcome(run)).toMatch(/Foreign key/);
    expect(await outcome(connect(B, { provider: 'zoom' }))).toBe('ok');
    expect(await outcome(connect(B))).toBe('ok');
  });
});

describe('connections', () => {
  it('hold one connection per provider and environment', async () => {
    expect(await outcome(connect(A))).toMatch(/Unique/i);
    expect(await outcome(connect(A, { environment: 'TEST' }))).toBe('ok');
  });
  it('keep a reference to the secret, never the secret', async () => {
    for (const bad of [
      { secretRef: 'sk_live_abc123' },
      { secretRef: 'has space' },
      { settings: { apiKey: 'x' } },
      { settings: { nested: { Client_Secret: 'x' } } },
    ]) {
      expect(await outcome(connect(A, { provider: 'xero', ...bad }))).toMatch(
        /integration_connections_values/,
      );
    }
    expect(
      await outcome(connect(A, { provider: 'xero', settings: { defaultCalendar: 'Primary' } })),
    ).toBe('ok');
  });
  it('need a reason when they need attention, and a time when disconnected', async () => {
    expect(await outcome(connect(A, { provider: 'square', status: 'NEEDS_ATTENTION' }))).toMatch(
      /values/,
    );
    expect(
      await outcome(
        connect(A, {
          provider: 'square',
          status: 'NEEDS_ATTENTION',
          statusReason: 'authorization_expired',
        }),
      ),
    ).toBe('ok');
    expect(await outcome(connect(A, { provider: 'calendly', status: 'DISCONNECTED' }))).toMatch(
      /values/,
    );
  });
  it('are never deleted', async () => {
    expect(await outcome(as(A).integrationConnection.delete({ where: { id: conn } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('sync runs', () => {
  it('finish once and then never change', async () => {
    const run = await as(A).integrationSyncRun.findFirstOrThrow();
    const where = { id: run.id };
    await as(A).integrationSyncRun.update({
      where,
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    await as(A).integrationSyncRun.update({
      where,
      data: { status: 'SUCCEEDED', finishedAt: new Date(), recordCount: 42 },
    });
    expect(
      await outcome(as(A).integrationSyncRun.update({ where, data: { recordCount: 1 } })),
    ).toMatch(/SYNC_RUN_FINISHED/);
  });
  it('need a finish time exactly when finished', async () => {
    const bad = as(A).integrationSyncRun.create({
      data: { businessId: A.id, connectionId: conn, entity: 'x', status: 'FAILED' },
    });
    expect(await outcome(bad)).toMatch(/sync_runs_values/);
  });
});
