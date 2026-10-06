// Portal sign-up verification codes (R3): only the code's HMAC is stored, the database clock sets
// created_at and the 15-minute expiry, attempts only go up, and only the newest unexpired code for
// an account and channel can be used, once. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', accountA: '', loginA: randomUUID() };
const emailA = `${ids.loginA}@vc.test`;
const minutes = (m: number) => new Date(Date.now() + m * 60_000);
const hmac = (code: string) => createHash('sha256').update(`${run}-${code}`).digest('hex');

const firmA = () => db.forBusiness(ids.firmA);
type Code = {
  channel?: 'EMAIL' | 'PHONE';
  target?: string;
  codeHash?: string;
  expiresAt?: Date;
  attempts?: number;
  consumedAt?: Date;
  createdAt?: Date;
};
/** A new code for firm A's client login, sent by email unless overridden. */
const send = (data: Code = {}) =>
  firmA().verificationCode.create({
    data: {
      businessId: ids.firmA,
      clientAccountId: ids.accountA,
      channel: 'EMAIL',
      target: emailA,
      codeHash: hmac(randomUUID()),
      expiresAt: minutes(10),
      ...data,
    },
  });
const update = (
  id: string,
  data: { attempts?: number; consumedAt?: Date | null; target?: string },
) => firmA().verificationCode.update({ where: { id }, data });
const dbNow = async () =>
  (await owner.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now.getTime();

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: { id: ids.loginA, cognitoSub: ids.loginA, pool: 'CLIENT', email: emailA, name: 'Fake' },
    });
    ids.firmA = (await tx.business.create({ data: { slug: `va-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `vb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.accountA = (
      await tx.clientAccount.create({
        data: { businessId: ids.firmA, userId: ids.loginA, email: emailA },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('sending a code', () => {
  it('stores only an HMAC, and the exact lower-case email or E.164 phone', async () => {
    for (const data of [
      { codeHash: '123456' },
      { target: emailA.toUpperCase() },
      { target: 'not-an-email' },
      { channel: 'PHONE' as const, target: '555-0100' },
      { channel: 'PHONE' as const, target: '+0123456789' },
    ]) {
      await expect(send(data)).rejects.toThrow(/check constraint/i);
    }
    await expect(send({ channel: 'PHONE', target: '+15555550100' })).resolves.toMatchObject({
      attempts: 0,
      consumedAt: null,
    });
  });

  it('starts unused with no attempts', async () => {
    await expect(send({ attempts: 2 })).rejects.toThrow(/no attempts and is not used/);
    await expect(send({ consumedAt: new Date() })).rejects.toThrow(/no attempts and is not used/);
  });

  it('created_at and the 15-minute expiry follow the database clock', async () => {
    for (const expiresAt of [minutes(-1), minutes(20)]) {
      await expect(send({ expiresAt })).rejects.toThrow(/within 15 minutes/);
    }
    // A slightly fast API clock: 15 minutes and 30 seconds is trimmed to exactly 15 minutes.
    const code = await send({ expiresAt: minutes(15.5), createdAt: minutes(-60) });
    expect(Math.abs(code.createdAt.getTime() - (await dbNow()))).toBeLessThan(60_000);
    expect(code.expiresAt.getTime() - code.createdAt.getTime()).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe('checking a code', () => {
  it('attempts only go up by one; nothing else changes', async () => {
    const code = await send();
    await expect(update(code.id, { attempts: 1 })).resolves.toMatchObject({ attempts: 1 });
    for (const attempts of [3, 0]) {
      await expect(update(code.id, { attempts })).rejects.toThrow(/up by one/);
    }
    await expect(update(code.id, { target: `other-${run}@vc.test` })).rejects.toThrow(
      /only attempts and consumed_at/,
    );
  });

  it('is used once, at the database time, and then never changes; nothing is deleted', async () => {
    const code = await send();
    const used = await update(code.id, { attempts: 1, consumedAt: new Date(0) });
    expect(used.consumedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    for (const data of [{ attempts: 2 }, { consumedAt: null }]) {
      await expect(update(code.id, data)).rejects.toThrow(/used code cannot change/);
    }
    await expect(firmA().verificationCode.deleteMany({})).rejects.toThrow(/permission denied/i);
  });

  it('only the newest code for that account and channel can be used', async () => {
    const older = await send();
    const phone = await send({ channel: 'PHONE', target: '+15555550101' });
    const newer = await send();
    await expect(update(older.id, { consumedAt: new Date() })).rejects.toThrow(/newest code/);
    await expect(update(newer.id, { consumedAt: new Date() })).resolves.toBeDefined();
    // A newer email code does not block the phone code.
    await expect(update(phone.id, { consumedAt: new Date() })).resolves.toBeDefined();
  });

  it('an expired code cannot be used', async () => {
    const code = await send({ expiresAt: new Date((await dbNow()) + 1_000) });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await expect(update(code.id, { consumedAt: new Date() })).rejects.toThrow(/expired/);
  });
});

describe('isolation', () => {
  it("firm B cannot see, use or attach a code to firm A's client login", async () => {
    const code = await send();
    const b = db.forBusiness(ids.firmB);
    expect(await b.verificationCode.findMany()).toEqual([]);
    expect(
      (await b.verificationCode.updateMany({ where: { id: code.id }, data: { attempts: 1 } }))
        .count,
    ).toBe(0);
    await expect(
      b.verificationCode.create({
        data: {
          businessId: ids.firmB,
          clientAccountId: ids.accountA,
          channel: 'EMAIL',
          target: emailA,
          codeHash: hmac('b'),
          expiresAt: minutes(10),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
