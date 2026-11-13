// Firm application response codes (R1, Nov 10; migration r1_firm_application_response_codes): the
// one-time code the applicant types after opening an information request's link. Only the code's
// HMAC is kept, the database clock sets created_at and the 10-minute expiry, a code is sent only
// for an open request with a live link, attempts only go up, and only the newest code of a request
// that is still open is used, once. Platform data: a firm never sees any of it. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const adminId = randomUUID();
const admin = () => db.forAdmin(adminId);
const platform = () => db.forPlatform();
const run = randomUUID().slice(0, 8);
const hmac = (code: string) => createHash('sha256').update(`${run}-${code}`).digest('hex');
const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex');
const days = (d: number) => new Date(Date.now() + d * 86_400_000);
const minutes = (m: number) => new Date(Date.now() + m * 60_000);
const dbNow = async () =>
  (await owner.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now.getTime();

/** A new application with one information request (open, with a 14-day link unless overridden). */
async function openRequest(data: Record<string, unknown> = {}): Promise<string> {
  const application = await platform().firmApplication.create({
    data: {
      legalName: 'Response Code Test LLC (fake)',
      contactName: 'Fake Applicant',
      contactEmail: `${randomUUID()}@farc.test`,
      data: {},
    },
    select: { id: true },
  });
  const request = await admin().firmApplicationInfoRequest.create({
    data: {
      applicationId: application.id,
      reason: 'Please send the firm license (fake).',
      requestedByUserId: adminId,
      tokenHash: tokenHash(),
      expiresAt: days(14),
      ...data,
    },
    select: { id: true },
  });
  return request.id;
}

type Code = {
  codeHash?: string;
  expiresAt?: Date;
  attempts?: number;
  consumedAt?: Date;
  createdAt?: Date;
};
/** A new code for the request, as the applicant's link sends it (platform scope). */
const send = (requestId: string, data: Code = {}) =>
  platform().firmApplicationResponseCode.create({
    data: { requestId, codeHash: hmac(randomUUID()), expiresAt: minutes(10), ...data },
  });
const update = (
  id: string,
  data: { attempts?: number; consumedAt?: Date | null; codeHash?: string; expiresAt?: Date },
) => platform().firmApplicationResponseCode.update({ where: { id }, data });
const close = (requestId: string) =>
  admin().firmApplicationInfoRequest.update({
    where: { id: requestId },
    data: { status: 'SUPERSEDED', closedAt: new Date() },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1farc');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: adminId,
        cognitoSub: adminId,
        pool: 'ADMIN',
        email: `${adminId}@farc.test`,
        name: 'Fake Admin',
      },
    });
    await tx.platformAdmin.create({ data: { userId: adminId } });
  });
});

describe('sending a code', () => {
  it('keeps only the hash, takes the database clock and trims the expiry to 10 minutes', async () => {
    const requestId = await openRequest();
    const code = await send(requestId, {
      expiresAt: minutes(10.5),
      createdAt: new Date(Date.now() - 3_600_000),
    });
    expect(code).toMatchObject({ attempts: 0, consumedAt: null });
    expect(Math.abs(code.createdAt.getTime() - (await dbNow()))).toBeLessThan(5_000);
    expect(code.expiresAt.getTime() - code.createdAt.getTime()).toBe(600_000);

    expect(await failure(send(requestId, { codeHash: '123456' }))).toMatch(
      /firm_application_response_codes_shape/,
    );
    for (const expiresAt of [minutes(12), new Date(Date.now() - 1_000)]) {
      expect(await failure(send(requestId, { expiresAt }))).toMatch(/within 10 minutes/);
    }
    for (const data of [{ attempts: 1 }, { consumedAt: new Date() }]) {
      expect(await failure(send(requestId, data)), JSON.stringify(data)).toMatch(/no attempts/);
    }
  });

  it('is refused once the request is closed or its link has expired', async () => {
    const closed = await openRequest();
    await close(closed);
    expect(await failure(send(closed))).toMatch(/open request/);

    const lapsed = await openRequest({ requestedAt: days(-15), expiresAt: days(-1) });
    expect(await failure(send(lapsed))).toMatch(/open request/);
  });
});

describe('using a code', () => {
  it('changes only attempts, one at a time, and consumed_at, once', async () => {
    const code = await send(await openRequest());
    await expect(update(code.id, { attempts: 1 })).resolves.toMatchObject({ attempts: 1 });
    expect(await failure(update(code.id, { attempts: 3 }))).toMatch(/up by one/);
    expect(await failure(update(code.id, { attempts: 0 }))).toMatch(/up by one/);
    for (const data of [{ codeHash: hmac('other') }, { expiresAt: minutes(5) }]) {
      expect(await failure(update(code.id, data)), JSON.stringify(data)).toMatch(
        /only attempts and consumed_at/,
      );
    }
    const used = await update(code.id, { consumedAt: new Date(Date.now() - 3_600_000) });
    // The database's clock, never the time the API sends.
    expect(Math.abs(used.consumedAt!.getTime() - (await dbNow()))).toBeLessThan(5_000);
    for (const data of [{ attempts: 2 }, { consumedAt: null }, { consumedAt: new Date() }]) {
      expect(await failure(update(code.id, data)), JSON.stringify(data)).toMatch(/used code/);
    }
  });

  it('uses only the newest code of the request', async () => {
    const requestId = await openRequest();
    const older = await send(requestId);
    const newer = await send(requestId);
    // Another request's newer code does not count against this one.
    await send(await openRequest());
    expect(await failure(update(older.id, { consumedAt: new Date() }))).toMatch(/newest code/);
    await expect(update(newer.id, { consumedAt: new Date() })).resolves.toMatchObject({
      attempts: 0,
    });
  });

  it('is refused once the request is closed', async () => {
    const requestId = await openRequest();
    const code = await send(requestId);
    await close(requestId);
    expect(await failure(update(code.id, { consumedAt: new Date() }))).toMatch(/no longer open/);
    // A wrong try is still counted.
    await expect(update(code.id, { attempts: 1 })).resolves.toMatchObject({ attempts: 1 });
  });

  it('an expired code cannot be used', async () => {
    const code = await send(await openRequest(), {
      expiresAt: new Date((await dbNow()) + 1_000),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await failure(update(code.id, { consumedAt: new Date() }))).toMatch(/expired/);
  });
});

describe('access and isolation', () => {
  it('admins read codes but never write them; nobody deletes one', async () => {
    const requestId = await openRequest();
    const code = await send(requestId);
    expect(
      await admin().firmApplicationResponseCode.findMany({ where: { requestId } }),
    ).toMatchObject([{ id: code.id }]);
    expect(
      await failure(
        admin().firmApplicationResponseCode.create({
          data: { requestId, codeHash: hmac('admin'), expiresAt: minutes(10) },
        }),
      ),
    ).toMatch(/row-level security|policy/i);
    expect(
      await failure(
        admin().firmApplicationResponseCode.update({
          where: { id: code.id },
          data: { attempts: 1 },
        }),
      ),
    ).not.toBe('');
    expect(
      await failure(platform().firmApplicationResponseCode.delete({ where: { id: code.id } })),
    ).toMatch(/permission denied/i);
    expect(
      await platform().firmApplicationResponseCode.findUnique({ where: { id: code.id } }),
    ).toMatchObject({ attempts: 0, consumedAt: null });
  });

  it("a firm never sees or sends an application's codes", async () => {
    const requestId = await openRequest();
    await send(requestId);
    for (const firmId of [f.firmA, f.firmB]) {
      const firm = db.forBusiness(firmId);
      expect(await firm.firmApplicationResponseCode.findMany({ where: { requestId } })).toEqual([]);
      expect(
        await failure(
          firm.firmApplicationResponseCode.create({
            data: { requestId, codeHash: hmac('firm'), expiresAt: minutes(10) },
          }),
        ),
        // The rules read the request first, which a firm cannot see; RLS would refuse it anyway.
      ).toMatch(/row-level security|policy|open request/i);
    }
  });
});
