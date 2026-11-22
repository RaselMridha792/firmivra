// Q32 (SA-FRM-F07/F08): emailed access codes for a closed firm's download-only grant. Codes are
// hashed, short-lived, attempt-counted and single-use. Platform data; no firm can read or write it.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let firms: TwoFirms;
const adminId = randomUUID();
const admin = () => db.forAdmin(adminId);
const platform = () => db.forPlatform();
const run = randomUUID().slice(0, 8);
const hmac = (code: string) => createHash('sha256').update(`${run}-${code}`).digest('hex');
const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex');
const minutes = (value: number) => new Date(Date.now() + value * 60_000);
const dbNow = async () =>
  (await owner.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now.getTime();

let grantId: string;

beforeAll(async () => {
  firms = await createTwoFirms(owner, 'q32fdc');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: adminId,
        cognitoSub: adminId,
        pool: 'ADMIN',
        email: `${adminId}@q32fdc.test`,
        name: 'Fake Admin',
      },
    });
    await tx.platformAdmin.create({ data: { userId: adminId } });
  });
  await runInScope(owner, { kind: 'business', businessId: firms.firmA }, (tx) =>
    tx.membership.update({
      where: { businessId_userId: { businessId: firms.firmA, userId: firms.memberA } },
      data: { role: 'OWNER' },
    }),
  );
  await admin().business.update({ where: { id: firms.firmA }, data: { status: 'ACTIVE' } });
  const closed = await admin().business.update({
    where: { id: firms.firmA },
    data: { status: 'CLOSED' },
    select: { closedAt: true },
  });
  const grant = await admin().firmDataDownloadGrant.create({
    data: {
      businessId: firms.firmA,
      ownerUserId: firms.memberA,
      kind: 'AUTOMATIC',
      tokenHash: tokenHash(),
      expiresAt: new Date(closed.closedAt!.getTime() + 30 * 86_400_000),
    },
    select: { id: true },
  });
  grantId = grant.id;
});

const send = (
  data: {
    codeHash?: string;
    expiresAt?: Date;
    attempts?: number;
    consumedAt?: Date;
    createdAt?: Date;
  } = {},
) =>
  platform().firmDataDownloadCode.create({
    data: { grantId, codeHash: hmac(randomUUID()), expiresAt: minutes(10), ...data },
  });

const update = (
  id: string,
  data: { attempts?: number; consumedAt?: Date | null; codeHash?: string; expiresAt?: Date },
) => platform().firmDataDownloadCode.update({ where: { id }, data });

describe('issuing a download code', () => {
  it('stores only the hash, uses database time and limits expiry to ten minutes', async () => {
    const code = await send({
      expiresAt: minutes(10.5),
      createdAt: new Date(Date.now() - 3_600_000),
    });
    expect(code).toMatchObject({ attempts: 0, consumedAt: null });
    expect(Math.abs(code.createdAt.getTime() - (await dbNow()))).toBeLessThan(5_000);
    expect(code.expiresAt.getTime() - code.createdAt.getTime()).toBe(600_000);
    expect(await failure(send({ codeHash: '123456' }))).toMatch(/firm_data_download_codes_shape/);
    for (const data of [{ attempts: 1 }, { consumedAt: new Date() }]) {
      expect(await failure(send(data))).toMatch(/new code has no attempts/);
    }
  });

  it('refuses a code when its grant is revoked', async () => {
    const revoked = await admin().firmDataDownloadGrant.create({
      data: {
        businessId: firms.firmA,
        ownerUserId: firms.memberA,
        kind: 'REQUESTED',
        reason: 'Synthetic test grant',
        grantedByUserId: adminId,
        tokenHash: tokenHash(),
        expiresAt: minutes(15),
        revokedAt: new Date(),
        revokedByUserId: adminId,
        revokeReason: 'Synthetic test revoke',
      },
      select: { id: true },
    });
    expect(
      await failure(
        platform().firmDataDownloadCode.create({
          data: { grantId: revoked.id, codeHash: hmac('revoked'), expiresAt: minutes(10) },
        }),
      ),
    ).toMatch(/active download grant/);
  });
});

describe('using a download code', () => {
  it('increments attempts one at a time and consumes once using database time', async () => {
    const code = await send();
    await expect(update(code.id, { attempts: 1 })).resolves.toMatchObject({ attempts: 1 });
    expect(await failure(update(code.id, { attempts: 3 }))).toMatch(/up by one/);
    const used = await update(code.id, { consumedAt: new Date(Date.now() - 3_600_000) });
    expect(Math.abs(used.consumedAt!.getTime() - (await dbNow()))).toBeLessThan(5_000);
    expect(await failure(update(code.id, { attempts: 2 }))).toMatch(/used code/);
  });

  it('allows only the newest code for a grant to be consumed', async () => {
    const older = await send();
    const newer = await send();
    expect(await failure(update(older.id, { consumedAt: new Date() }))).toMatch(/newest code/);
    await expect(update(newer.id, { consumedAt: new Date() })).resolves.toMatchObject({
      attempts: 0,
    });
  });
});

describe('access and isolation', () => {
  it('lets admins read but not write codes; no role can delete them', async () => {
    const code = await send();
    expect(await admin().firmDataDownloadCode.findUnique({ where: { id: code.id } })).toMatchObject(
      { id: code.id },
    );
    expect(
      await failure(
        admin().firmDataDownloadCode.create({
          data: { grantId, codeHash: hmac('admin'), expiresAt: minutes(10) },
        }),
      ),
    ).toMatch(/row-level security|policy/i);
    expect(
      await failure(platform().firmDataDownloadCode.delete({ where: { id: code.id } })),
    ).toMatch(/permission denied/i);
    expect(await db.forBusiness(firms.firmA).firmDataDownloadCode.findMany()).toEqual([]);
    expect(await db.forBusiness(firms.firmB).firmDataDownloadCode.findMany()).toEqual([]);
  });
});
