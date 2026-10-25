// R60's request 13 (R1, Oct 25; migration r1_staff_phone_codes): the codes sent to verify a staff
// member's phone. As for the clients' verification_codes: only the code's HMAC is stored, the
// database clock sets created_at and the 15-minute expiry, attempts only go up, and only the
// newest unexpired code for that member can be used, once. A firm never sees another firm's codes.
// Runs as the app role under RLS.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const run = randomUUID().slice(0, 8);
const minutes = (m: number) => new Date(Date.now() + m * 60_000);
const hmac = (code: string) => createHash('sha256').update(`${run}-${code}`).digest('hex');
const dbNow = async () =>
  (await owner.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now.getTime();

const A = () => db.forBusiness(f.firmA);
type Code = {
  userId?: string;
  target?: string;
  codeHash?: string;
  expiresAt?: Date;
  attempts?: number;
  consumedAt?: Date;
  createdAt?: Date;
};
/** A new code for firm A's member `a`, unless overridden. */
const send = (data: Code = {}) =>
  A().staffPhoneCode.create({
    data: {
      businessId: f.firmA,
      userId: f.memberA,
      target: '+15555550100',
      codeHash: hmac(randomUUID()),
      expiresAt: minutes(10),
      ...data,
    },
  });
const update = (
  id: string,
  data: { attempts?: number; consumedAt?: Date | null; target?: string },
) => A().staffPhoneCode.update({ where: { id }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1spc');
});

describe('sending a code', () => {
  it('stores only an HMAC, and the exact E.164 number', async () => {
    for (const data of [
      { codeHash: '123456' },
      { target: '555-0100' },
      { target: '+0123456789' },
      { target: 'staff@example.test' },
    ]) {
      await expect(send(data)).rejects.toThrow(/check constraint/i);
    }
    await expect(send()).resolves.toMatchObject({ attempts: 0, consumedAt: null });
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

  it("goes only to a member of the code's firm", async () => {
    expect(await failure(send({ userId: f.memberB }))).toMatch(/foreign key/i);
  });
});

describe('checking a code', () => {
  it('attempts only go up by one; nothing else changes', async () => {
    const code = await send();
    await expect(update(code.id, { attempts: 1 })).resolves.toMatchObject({ attempts: 1 });
    for (const attempts of [3, 0]) {
      await expect(update(code.id, { attempts })).rejects.toThrow(/up by one/);
    }
    await expect(update(code.id, { target: '+15555550199' })).rejects.toThrow(
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
    await expect(A().staffPhoneCode.deleteMany({})).rejects.toThrow(/permission denied/i);
  });

  it('only the newest code for that member can be used', async () => {
    const older = await send();
    const other = await send({ userId: f.member2A, target: '+15555550101' });
    const newer = await send();
    await expect(update(older.id, { consumedAt: new Date() })).rejects.toThrow(/newest code/);
    await expect(update(newer.id, { consumedAt: new Date() })).resolves.toBeDefined();
    // Another member's newer code does not block theirs, nor theirs this one.
    await expect(update(other.id, { consumedAt: new Date() })).resolves.toBeDefined();
  });

  it('an expired code cannot be used', async () => {
    const code = await send({ expiresAt: new Date((await dbNow()) + 1_000) });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await expect(update(code.id, { consumedAt: new Date() })).rejects.toThrow(/expired/);
  });
});

describe('isolation', () => {
  it("firm B cannot see, use or write a code for firm A's member", async () => {
    const code = await send();
    const B = db.forBusiness(f.firmB);
    expect(await B.staffPhoneCode.findMany()).toEqual([]);
    const { count } = await B.staffPhoneCode.updateMany({
      where: { id: code.id },
      data: { attempts: 1 },
    });
    expect(count).toBe(0);
    const data = {
      userId: f.memberA,
      target: '+15555550102',
      codeHash: hmac('b'),
      expiresAt: minutes(10),
    };
    expect(
      await failure(B.staffPhoneCode.create({ data: { businessId: f.firmA, ...data } })),
    ).toMatch(/row-level security/i);
    expect(
      await failure(B.staffPhoneCode.create({ data: { businessId: f.firmB, ...data } })),
    ).toMatch(/foreign key/i);
  });
});
