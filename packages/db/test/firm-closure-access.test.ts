// Firm closure and exceptional access (R1, Nov 10; migration r1_firm_closure_access, FIRMS.md
// section F): closed_at set by the database on closure; one platform owner; the closed firm owner's
// download grants (30 days automatically, never past day 90, revoked once) and their log;
// exceptional-access requests reviewed by the platform owner only, read-only within a window; and
// a firm never sees any of it. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const ids = { admin: randomUUID(), platformOwner: randomUUID(), other: randomUUID() };
let closedAt = new Date();
const admin = () => db.forAdmin(ids.admin);
const ownerAdmin = () => db.forAdmin(ids.platformOwner);
const platform = () => db.forPlatform();
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
const days = (d: number) => new Date(closedAt.getTime() + d * 86_400_000);

const grant = (data: Record<string, unknown>) =>
  admin().firmDataDownloadGrant.create({
    data: {
      businessId: f.firmA,
      ownerUserId: f.memberA,
      kind: 'REQUESTED',
      reason: 'Owner verified by phone (fake).',
      grantedByUserId: ids.admin,
      tokenHash: hash(),
      expiresAt: days(40),
      ...data,
    } as never,
  });
const request = (data: Record<string, unknown> = {}) =>
  ownerAdmin().firmExceptionalAccessRequest.create({
    data: {
      businessId: f.firmB,
      requestedByUserId: ids.platformOwner,
      requesterName: 'Agent Fake',
      requesterOrganization: 'Fake Revenue Department',
      requesterContact: 'agent@fake-revenue.test',
      legalAuthority: 'Subpoena 2026-FAKE-001',
      scopeModules: ['DOCUMENTS', 'INVOICES'],
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1fca');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(ids)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@fca.test`, name: 'Fake Admin' },
      });
      await tx.platformAdmin.create({ data: { userId: id } });
    }
  });
});

describe('closure (SA-FRM-F03) and the platform owner (SA-FRM-F09)', () => {
  it('sets closed_at when the firm closes, and nobody sets it by hand', async () => {
    expect(
      await failure(
        platform().business.update({ where: { id: f.firmA }, data: { closedAt: new Date() } }),
      ),
    ).toMatch(/set by the database/);
    const closed = await platform().business.update({
      where: { id: f.firmA },
      data: { status: 'CLOSED' },
      select: { closedAt: true },
    });
    expect(closed.closedAt).toEqual(expect.any(Date));
    closedAt = closed.closedAt!;
  });

  it('has at most one platform owner, set only by the owner role (bootstrap)', async () => {
    const mark = (userId: string) =>
      runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.platformAdmin.update({ where: { userId }, data: { isPlatformOwner: true } }),
      );
    await mark(ids.platformOwner);
    expect(await failure(mark(ids.other))).toMatch(/unique|one_owner/i);
    expect(
      await failure(
        platform().platformAdmin.update({
          where: { userId: ids.other },
          data: { isPlatformOwner: true },
        }),
      ),
    ).toMatch(/permission denied/i);
  });
});

describe("the closed firm owner's download grants (SA-FRM-F07, F08)", () => {
  it('gives the automatic grant exactly 30 days and a requested one up to day 90', async () => {
    await expect(
      grant({ kind: 'AUTOMATIC', reason: null, grantedByUserId: null, expiresAt: days(30) }),
    ).resolves.toMatchObject({ kind: 'AUTOMATIC' });
    expect(
      await failure(
        grant({ kind: 'AUTOMATIC', reason: null, grantedByUserId: null, expiresAt: days(31) }),
      ),
    ).toMatch(/30 days after closure/);
    await expect(grant({ expiresAt: days(90) })).resolves.toMatchObject({ kind: 'REQUESTED' });
    expect(await failure(grant({ expiresAt: days(91) }))).toMatch(/never past day 90/);
    expect(await failure(grant({ reason: null }))).toMatch(/firm_data_download_grants_shape/);
  });

  it('only for a closed firm', async () => {
    expect(await failure(grant({ businessId: f.firmB, ownerUserId: f.memberB }))).toMatch(
      /only a closed firm/,
    );
  });

  it('is revoked once and otherwise never changes; its log is insert-only', async () => {
    const g = await grant({});
    expect(
      await failure(
        admin().firmDataDownloadGrant.update({
          where: { id: g.id },
          data: { expiresAt: days(60) },
        }),
      ),
    ).toMatch(/only gets revoked, once/);
    await admin().firmDataDownloadGrant.update({
      where: { id: g.id },
      data: {
        revokedAt: new Date(),
        revokedByUserId: ids.admin,
        revokeReason: 'Owner asked (fake).',
      },
    });
    expect(
      await failure(
        admin().firmDataDownloadGrant.update({
          where: { id: g.id },
          data: { revokeReason: 'Changed' },
        }),
      ),
    ).toMatch(/only gets revoked, once/);
    const entry = await platform().firmDataDownloadLog.create({
      data: { businessId: f.firmA, grantId: g.id, event: 'DOWNLOADED', fileCount: 3, bytes: 4096n },
    });
    expect(
      await failure(
        platform().firmDataDownloadLog.update({ where: { id: entry.id }, data: { fileCount: 4 } }),
      ),
    ).toMatch(/permission denied/i);
  });
});

describe('exceptional access (SA-FRM-F11 to F13)', () => {
  it("opens only on the platform owner's approval, read-only within its window", async () => {
    const r = await request();
    const review = (as: () => ReturnType<typeof admin>, data: Record<string, unknown>) =>
      as().firmExceptionalAccessRequest.update({ where: { id: r.id }, data: data as never });
    const window = {
      windowStartsAt: new Date(),
      windowEndsAt: new Date(Date.now() + 4 * 3_600_000),
    };
    expect(
      await failure(
        review(admin, {
          status: 'APPROVED',
          reviewedByUserId: ids.admin,
          reviewedAt: new Date(),
          ...window,
        }),
      ),
    ).toMatch(/only the platform owner/);
    expect(
      await failure(
        review(ownerAdmin, {
          status: 'APPROVED',
          reviewedByUserId: ids.platformOwner,
          reviewedAt: new Date(),
        }),
      ),
    ).toMatch(/firm_exceptional_access_requests_shape/);
    await expect(
      review(ownerAdmin, {
        status: 'APPROVED',
        reviewedByUserId: ids.platformOwner,
        reviewedAt: new Date(),
        ...window,
      }),
    ).resolves.toMatchObject({ status: 'APPROVED', accessMode: 'READ_ONLY' });
    expect(await failure(review(ownerAdmin, { legalAuthority: 'Changed' }))).toMatch(
      /never changes/,
    );
    expect(await failure(review(ownerAdmin, { status: 'PENDING' }))).toMatch(/cannot go from/);
    await expect(
      review(ownerAdmin, { status: 'REVOKED', revokedAt: new Date() }),
    ).resolves.toMatchObject({ status: 'REVOKED' });
  });

  it('refuses a request without scope, a write mode or a document outside its folder', async () => {
    for (const data of [
      { scopeModules: [] },
      { accessMode: 'READ_WRITE' },
      { documentS3Key: `tenant/${f.firmA}/exceptional-access/x/letter.pdf` },
    ]) {
      expect(await failure(request(data)), JSON.stringify(data)).toMatch(
        /firm_exceptional_access_requests_shape/,
      );
    }
  });
});

describe('isolation', () => {
  it('a firm never sees or writes grants, logs or access requests', async () => {
    for (const firm of [db.forBusiness(f.firmA), db.forBusiness(f.firmB)]) {
      expect(await firm.firmDataDownloadGrant.findMany()).toEqual([]);
      expect(await firm.firmDataDownloadLog.findMany()).toEqual([]);
      expect(await firm.firmExceptionalAccessRequest.findMany()).toEqual([]);
    }
    expect(
      await failure(
        db.forBusiness(f.firmA).firmDataDownloadGrant.create({
          data: {
            businessId: f.firmA,
            ownerUserId: f.memberA,
            kind: 'AUTOMATIC',
            tokenHash: hash(),
            expiresAt: days(30),
          },
        }),
      ),
    ).toMatch(/row-level security|policy/i);
  });
});
