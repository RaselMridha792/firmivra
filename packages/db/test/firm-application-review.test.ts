// Firm application review (R1, Nov 7; migrations r1_firm_application_in_review and
// r1_firm_application_review; FIRM-APPLICATIONS.md SA-APP-F02 to F06): In Review on open with its
// history row, the transitions (never back to Pending), the assigned reviewer, information requests
// (one open, the token's hash only, closed once), the applicant's response on the same application,
// and its scanned files under the application's folder. Platform data: a firm never sees any of it.
// Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const ids = { admin: randomUUID(), notAdmin: randomUUID(), app: '', other: '' };
const admin = () => db.forAdmin(ids.admin);
const platform = () => db.forPlatform();
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
const later = () => new Date(Date.now() + 14 * 86_400_000);

const application = (name: string) =>
  platform().firmApplication.create({
    data: {
      legalName: `${name} LLC (fake)`,
      contactName: 'Fake Applicant',
      contactEmail: `${randomUUID()}@far.test`,
      data: {},
    },
    select: { id: true },
  });
const request = (applicationId: string, data: Record<string, unknown> = {}) =>
  admin().firmApplicationInfoRequest.create({
    data: {
      applicationId,
      reason: 'Please send the firm license (fake).',
      requestedByUserId: ids.admin,
      tokenHash: hash(),
      expiresAt: later(),
      ...data,
    },
  });
const review = (data: Record<string, unknown>) =>
  admin().firmApplication.update({
    where: { id: ids.app },
    data: { reviewedByUserId: ids.admin, ...data },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1far');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.admin, ids.notAdmin]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@far.test`, name: 'Fake Admin' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
  });
  ids.app = (await application('Harbor')).id;
  ids.other = (await application('Summit')).id;
});

describe('In Review and the transitions (SA-APP-F02)', () => {
  it('opens to In Review with a history row, and never returns to Pending', async () => {
    await review({ status: 'IN_REVIEW' });
    const history = await platform().firmApplicationStatusHistory.findMany({
      where: { applicationId: ids.app },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.at(-1)).toMatchObject({
      fromStatus: 'PENDING_REVIEW',
      toStatus: 'IN_REVIEW',
      changedByUserId: ids.admin,
    });
    expect(await failure(review({ status: 'PENDING_REVIEW' }))).toMatch(/cannot go from/);
    await review({ status: 'INFO_REQUESTED', decisionReason: 'Please send the license (fake).' });
    // An answered request goes back to In Review.
    await expect(review({ status: 'IN_REVIEW' })).resolves.toMatchObject({ status: 'IN_REVIEW' });
  });

  it('assigns a platform admin as reviewer, never another user', async () => {
    await expect(
      admin().firmApplication.update({
        where: { id: ids.app },
        data: { assignedReviewerUserId: ids.admin },
      }),
    ).resolves.toMatchObject({ assignedReviewerUserId: ids.admin });
    expect(
      await failure(
        admin().firmApplication.update({
          where: { id: ids.app },
          data: { assignedReviewerUserId: ids.notAdmin },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});

describe('information requests (SA-APP-F03)', () => {
  it('keeps one open request, stores only the hash, and closes a request once', async () => {
    const first = await request(ids.app);
    expect(await failure(request(ids.app))).toMatch(/one_open|unique/i);
    for (const data of [{ tokenHash: 'not-a-hash' }, { reason: ' ' }, { expiresAt: new Date(0) }]) {
      expect(await failure(request(ids.other, data)), JSON.stringify(data)).toMatch(
        /firm_application_info_requests_shape/,
      );
    }
    // A repeat request supersedes the open one.
    await admin().firmApplicationInfoRequest.update({
      where: { id: first.id },
      data: { status: 'SUPERSEDED', closedAt: new Date() },
    });
    await expect(request(ids.app)).resolves.toMatchObject({ status: 'OPEN' });
    for (const data of [{ status: 'OPEN', closedAt: null }, { reason: 'Changed later (fake).' }]) {
      expect(
        await failure(admin().firmApplicationInfoRequest.update({ where: { id: first.id }, data })),
        JSON.stringify(data),
      ).toMatch(/only closes, once/);
    }
    expect(
      await failure(
        admin().firmApplicationInfoRequest.update({
          where: { id: first.id },
          data: { status: 'RESPONDED' },
        }),
      ),
    ).toMatch(/only closes, once|firm_application_info_requests_shape/);
  });
});

describe("the applicant's response and its files (SA-APP-F04)", () => {
  it('answers a request of the same application, with scanned files under its folder', async () => {
    const open = await platform().firmApplicationInfoRequest.findFirstOrThrow({
      where: { applicationId: ids.app, status: 'OPEN' },
    });
    const response = await platform().firmApplicationResponse.create({
      data: { applicationId: ids.app, requestId: open.id, text: 'License attached (fake).' },
    });
    expect(
      await failure(
        platform().firmApplicationResponse.create({
          data: { applicationId: ids.other, requestId: open.id, text: 'Wrong application' },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(
      await failure(
        platform().firmApplicationResponse.update({
          where: { id: response.id },
          data: { text: 'Changed' },
        }),
      ),
    ).toMatch(/never changes/);

    const file = (data: Record<string, unknown> = {}) => {
      const id = randomUUID();
      return platform().firmApplicationResponseFile.create({
        data: {
          id,
          applicationId: ids.app,
          responseId: response.id,
          s3Key: `tenant/${ids.app}/applications/${response.id}/${id}`,
          fileName: 'license.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          ...data,
        },
      });
    };
    const stored = await file();
    expect(stored.scanStatus).toBe('PENDING');
    for (const data of [
      { s3Key: `tenant/${ids.other}/applications/${response.id}/x` },
      { contentType: 'image/gif' },
      { sizeBytes: 10_485_761 },
    ]) {
      expect(await failure(file(data)), JSON.stringify(data)).toMatch(
        /firm_application_response_files_shape/,
      );
    }
    await expect(
      platform().firmApplicationResponseFile.update({
        where: { id: stored.id },
        data: { scanStatus: 'CLEAN' },
      }),
    ).resolves.toMatchObject({ scanStatus: 'CLEAN' });
    expect(
      await failure(
        platform().firmApplicationResponseFile.update({
          where: { id: stored.id },
          data: { fileName: 'renamed.pdf' },
        }),
      ),
    ).toMatch(/only the scan result/);
  });
});

describe('isolation', () => {
  it("a firm never sees an application's requests, responses or files", async () => {
    const firm = db.forBusiness(f.firmA);
    expect(await firm.firmApplicationInfoRequest.findMany()).toEqual([]);
    expect(await firm.firmApplicationResponse.findMany()).toEqual([]);
    expect(await firm.firmApplicationResponseFile.findMany()).toEqual([]);
    expect(
      await failure(
        firm.firmApplicationInfoRequest.create({
          data: {
            applicationId: ids.other,
            reason: 'From a firm (fake)',
            requestedByUserId: ids.admin,
            tokenHash: hash(),
            expiresAt: later(),
          },
        }),
      ),
    ).toMatch(/row-level security|policy/i);
  });
});
