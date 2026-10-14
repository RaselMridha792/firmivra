// Bookkeeping, part 2 (R38): accounting connections, sync runs and accounts. Isolation between
// firms and the rules of migration r38_bookkeeping_connections. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let engA: string; // a bookkeeping engagement of firm A's client, with a profile
let engA2: string;
const A = () => db.forBusiness(f.firmA);
const day = (d: string) => new Date(d);
const connection = async (data: Record<string, unknown> = {}) =>
  A().bookkeepingConnection.create({
    data: {
      businessId: f.firmA,
      engagementId: await withProfile(f.firmA, f.clientA),
      provider: 'quickbooks',
      providerCompanyId: randomUUID(),
      ...data,
    },
  });
const account = (data: Record<string, unknown> = {}) =>
  A().bookkeepingAccount.create({
    data: {
      businessId: f.firmA,
      engagementId: engA,
      name: 'Checking (fake)',
      type: 'BANK',
      ...data,
    },
  });
async function withProfile(firm: string, client: string) {
  const engagementId = await createEngagement(owner, firm, client);
  await db
    .forBusiness(firm)
    .bookkeepingProfile.create({ data: { businessId: firm, engagementId } });
  return engagementId;
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38bc');
  engA = await withProfile(f.firmA, f.clientA);
  engA2 = await withProfile(f.firmA, f.clientA);
});

describe('isolation', () => {
  it('another firm sees no connection, sync run or account', async () => {
    const c = await connection();
    await A().bookkeepingSyncRun.create({
      data: { businessId: f.firmA, connectionId: c.id, trigger: 'INITIAL' },
    });
    await account({ engagementId: c.engagementId, connectionId: c.id, sourceAccountId: 'a1' });
    const B = db.forBusiness(f.firmB);
    expect(await B.bookkeepingConnection.findMany()).toEqual([]);
    expect(await B.bookkeepingSyncRun.findMany()).toEqual([]);
    expect(await B.bookkeepingAccount.findMany()).toEqual([]);
    expect(
      await failure(
        B.bookkeepingConnection.create({
          data: {
            businessId: f.firmA,
            engagementId: engA,
            provider: 'xero',
            providerCompanyId: '1',
          },
        }),
      ),
    ).toMatch(/row-level security|violates|bookkeeping profile/i);
  });

  it("refuses another firm's engagement and connection", async () => {
    const engB = await withProfile(f.firmB, f.clientB);
    expect(await failure(connection({ engagementId: engB }))).toMatch(
      /foreign key|bookkeeping profile/i,
    );
    const cB = await db.forBusiness(f.firmB).bookkeepingConnection.create({
      data: { businessId: f.firmB, engagementId: engB, provider: 'xero', providerCompanyId: '9' },
    });
    expect(await failure(account({ connectionId: cB.id, sourceAccountId: 'x' }))).toMatch(
      /foreign key|own client/i,
    );
  });
});

describe('connections', () => {
  it('have a provider code, a company id and a secret-store reference, never a token', async () => {
    for (const data of [
      { provider: 'QuickBooks Online' },
      { provider: 'q' },
      { providerCompanyId: ' ' },
      { credentialRef: 'Bearer abc def' },
      { credentialRef: 'x'.repeat(201) },
      { status: 'DISCONNECTED' },
      { disconnectedAt: new Date() },
      { lastSuccessfulSyncAt: new Date() }, // needs lastSyncAt
    ]) {
      expect(await failure(connection(data))).toMatch(/check constraint/i);
    }
    await expect(
      connection({
        provider: 'zoho_books',
        credentialRef: 'prod/firm/zoho-1',
        companyName: 'Fake LLC',
      }),
    ).resolves.toBeTruthy();
  });

  it('allow one live connection per provider company and per client and provider', async () => {
    const company = randomUUID();
    const c1 = await connection({ providerCompanyId: company });
    expect(await failure(connection({ providerCompanyId: company }))).toMatch(/unique/i);
    await expect(
      connection({ providerCompanyId: company, provider: 'xero' }),
    ).resolves.toBeTruthy();
    // The same client cannot hold two live QuickBooks companies.
    expect(await failure(connection({ engagementId: c1.engagementId }))).toMatch(/unique/i);
    // Disconnecting keeps the row and frees the company; reconnecting reuses the row.
    await A().bookkeepingConnection.update({
      where: { id: c1.id },
      data: { status: 'DISCONNECTED', disconnectedAt: new Date() },
    });
    await expect(
      connection({ providerCompanyId: company, engagementId: engA2 }),
    ).resolves.toBeTruthy();
    expect(await A().bookkeepingConnection.findUnique({ where: { id: c1.id } })).toMatchObject({
      status: 'DISCONNECTED',
    });
  });

  it('need a client with a bookkeeping profile and keep their client, provider and company', async () => {
    const bare = await createEngagement(owner, f.firmA, f.clientA);
    expect(await failure(connection({ engagementId: bare }))).toMatch(/bookkeeping profile/);
    const c = await connection({ provider: 'freshbooks' });
    for (const data of [
      { engagementId: engA2 },
      { provider: 'xero' },
      { providerCompanyId: 'other' },
    ]) {
      expect(
        await failure(A().bookkeepingConnection.update({ where: { id: c.id }, data })),
      ).toMatch(/keeps its client/);
    }
  });

  it('a failed sync never erases the last successful one, which only moves forward', async () => {
    const c = await connection({ provider: 'zoho_books' });
    const t1 = day('2026-09-28T10:00:00Z');
    const upd = (data: Record<string, unknown>) =>
      A().bookkeepingConnection.update({ where: { id: c.id }, data });
    await upd({ lastSyncAt: t1, lastSuccessfulSyncAt: t1 });
    await expect(
      upd({
        lastSyncAt: day('2026-09-29T10:00:00Z'),
        status: 'ERROR',
        lastErrorCode: 'RATE_LIMITED',
      }),
    ).resolves.toMatchObject({ lastSuccessfulSyncAt: t1, status: 'ERROR' });
    expect(await failure(upd({ lastSuccessfulSyncAt: null }))).toMatch(/never erases/);
    expect(await failure(upd({ lastSuccessfulSyncAt: day('2026-09-01T00:00:00Z') }))).toMatch(
      /never erases/,
    );
    await expect(
      upd({
        lastSuccessfulSyncAt: day('2026-09-30T10:00:00Z'),
        lastSyncAt: day('2026-09-30T10:00:00Z'),
        status: 'CONNECTED',
        lastErrorCode: null,
      }),
    ).resolves.toMatchObject({ status: 'CONNECTED' });
  });
});

describe('sync runs', () => {
  it('end once, with an error code only for a failure', async () => {
    const c = await connection({ provider: 'xero' });
    const run = (data: Record<string, unknown> = {}) =>
      A().bookkeepingSyncRun.create({
        data: { businessId: f.firmA, connectionId: c.id, trigger: 'SCHEDULED', ...data },
      });
    for (const data of [
      { outcome: 'SUCCESS' },
      { finishedAt: new Date() },
      { outcome: 'SUCCESS', finishedAt: new Date(), errorCode: 'X' },
      { outcome: 'FAILED', finishedAt: new Date(Date.now() - 1e7) },
      { counts: [] },
      { message: 'x'.repeat(301) },
    ]) {
      expect(await failure(run(data))).toMatch(/check constraint/i);
    }
    const started = await run();
    await expect(
      A().bookkeepingSyncRun.update({
        where: { id: started.id },
        data: {
          outcome: 'FAILED',
          finishedAt: new Date(),
          errorCode: 'EXPIRED_TOKEN',
          message: 'Reconnect',
        },
      }),
    ).resolves.toMatchObject({ outcome: 'FAILED' });
    expect(await failure(A().bookkeepingSyncRun.delete({ where: { id: started.id } }))).toMatch(
      /permission denied/i,
    );
  });
});

describe('accounts', () => {
  it('keep only the last digits, a balance with its date, and a synced id with its connection', async () => {
    for (const data of [
      { mask: '123456789012' },
      { mask: '1' },
      { balanceCents: 100 },
      { balanceAsOf: new Date() },
      { sourceAccountId: 'a1' }, // needs a connection
      { name: ' ' },
      { currency: 'US' },
    ]) {
      expect(await failure(account(data))).toMatch(/check constraint/i);
    }
    await expect(
      account({
        type: 'CREDIT_CARD',
        mask: '4242',
        balanceCents: -234012,
        balanceAsOf: new Date(),
      }),
    ).resolves.toMatchObject({ currency: 'usd', reconcile: true });
  });

  it("belong to their client's connection, one per provider account id", async () => {
    const c = await connection({ provider: 'freshbooks', engagementId: engA2 });
    expect(await failure(account({ connectionId: c.id, sourceAccountId: 'a1' }))).toMatch(
      /own client/,
    );
    await account({ engagementId: engA2, connectionId: c.id, sourceAccountId: 'a1' });
    expect(
      await failure(account({ engagementId: engA2, connectionId: c.id, sourceAccountId: 'a1' })),
    ).toMatch(/unique/i);
    const bare = await createEngagement(owner, f.firmA, f.clientA);
    expect(await failure(account({ engagementId: bare }))).toMatch(/bookkeeping profile/);
    const a = await account();
    expect(
      await failure(
        A().bookkeepingAccount.update({ where: { id: a.id }, data: { engagementId: engA2 } }),
      ),
    ).toMatch(/cannot move/);
  });
});
