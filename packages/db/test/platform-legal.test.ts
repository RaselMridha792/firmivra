// R0 stage D4 (Oct 19): Firmivra's own legal documents and their acceptances. Versions are
// numbered per kind and start as drafts; publishing stamps the time and retires the previous
// version; a published text never changes; only drafts are deleted. Acceptances are of the
// published version, insert-only, stamped by the database; a firm records and reads its own.
// Uses the DPA and Acceptable Use kinds so it never meets seed.test's Terms and Privacy rows.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  outsider: randomUUID(),
  member: randomUUID(),
  firmA: '',
  firmB: '',
};

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>, adminUserId = ids.admin) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId }, fn);
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

type Kind = 'DATA_PROCESSING_AGREEMENT' | 'ACCEPTABLE_USE';
/** The next version of a kind, as a new draft. */
const draft = async (kind: Kind, extra: Record<string, unknown> = {}) => {
  const last = await asAdmin((tx) =>
    tx.platformLegalDocument.aggregate({ where: { kind }, _max: { version: true } }),
  );
  return asAdmin((tx) =>
    tx.platformLegalDocument.create({
      data: {
        kind,
        version: (last._max.version ?? 0) + 1,
        title: `Firmivra ${kind} ${run}`,
        body: '# Sample\n\nSample text for tests. Not legal text.',
        ...extra,
      },
    }),
  );
};
const publish = (id: string) =>
  asAdmin((tx) =>
    tx.platformLegalDocument.update({ where: { id }, data: { status: 'PUBLISHED' } }),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.admin, ids.outsider, ids.member]) {
      await tx.user.create({
        data: {
          id,
          cognitoSub: id,
          pool: id === ids.member ? 'STAFF' : 'ADMIN',
          email: `${id}@legal.test`,
          name: 'Fake',
        },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.outsider, role: 'TEAM_MEMBER' } });
    ids.firmA = (await tx.business.create({ data: { slug: `la-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `lb-${run}`, name: 'B' } })).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect()]);
});

describe('platform legal documents', () => {
  it('start as the next draft of their kind, stamped by the database', async () => {
    const d = await draft('DATA_PROCESSING_AGREEMENT');
    expect(d).toMatchObject({ status: 'DRAFT', createdByUserId: ids.admin, publishedAt: null });
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformLegalDocument.create({
            data: {
              kind: 'DATA_PROCESSING_AGREEMENT',
              version: d.version + 5,
              title: 'Skip',
              body: 'x',
            },
          }),
        ),
      ),
    ).toMatch(/next DATA_PROCESSING_AGREEMENT version/);
    expect(await outcome(draft('ACCEPTABLE_USE', { status: 'PUBLISHED' }))).toMatch(
      /starts as a draft/,
    );
  });

  it('publishing stamps the time and retires the previous version; one is in force per kind', async () => {
    const first = await draft('ACCEPTABLE_USE');
    const published = await publish(first.id);
    expect(published.publishedAt).not.toBeNull();
    expect(published.effectiveAt).not.toBeNull();
    expect(published.publishedByUserId).toBe(ids.admin);

    const second = await draft('ACCEPTABLE_USE', { summaryOfChanges: 'Clearer limits.' });
    await publish(second.id);
    const before = await asAdmin((tx) =>
      tx.platformLegalDocument.findUniqueOrThrow({ where: { id: first.id } }),
    );
    expect(before.status).toBe('RETIRED');
    expect(before.retiredAt).not.toBeNull();
    const inForce = await asAdmin((tx) =>
      tx.platformLegalDocument.count({ where: { kind: 'ACCEPTABLE_USE', status: 'PUBLISHED' } }),
    );
    expect(inForce).toBe(1);
  });

  it('a published text never changes, retired is final, and only drafts are deleted', async () => {
    const d = await draft('DATA_PROCESSING_AGREEMENT');
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformLegalDocument.update({ where: { id: d.id }, data: { body: 'Edited' } }),
        ),
      ),
    ).toBe('ok');
    await publish(d.id);
    for (const data of [
      { body: 'Changed' },
      { title: 'Renamed' },
      { requiresReacceptance: true },
    ]) {
      expect(
        await outcome(
          asAdmin((tx) => tx.platformLegalDocument.update({ where: { id: d.id }, data })),
        ),
      ).toMatch(/never changes/);
    }
    expect(
      await outcome(asAdmin((tx) => tx.platformLegalDocument.delete({ where: { id: d.id } }))),
    ).toMatch(/only a draft is deleted/);
    const retired = await asAdmin((tx) =>
      tx.platformLegalDocument.update({ where: { id: d.id }, data: { status: 'RETIRED' } }),
    );
    expect(retired.retiredAt).not.toBeNull();
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformLegalDocument.update({ where: { id: d.id }, data: { status: 'PUBLISHED' } }),
        ),
      ),
    ).toMatch(/retired version never changes/);

    const throwaway = await draft('DATA_PROCESSING_AGREEMENT');
    expect(
      await outcome(
        asAdmin((tx) => tx.platformLegalDocument.delete({ where: { id: throwaway.id } })),
      ),
    ).toBe('ok');
  });

  it('every scope reads the published text; drafts and writes are the team’s', async () => {
    const d = await draft('ACCEPTABLE_USE');
    const where = { where: { id: d.id } };
    expect(await asFirm(ids.firmA, (tx) => tx.platformLegalDocument.count(where))).toBe(0);
    expect(await asAdmin((tx) => tx.platformLegalDocument.count(where), ids.outsider)).toBe(0);
    expect(await asPlatform((tx) => tx.platformLegalDocument.count(where))).toBe(1);
    await publish(d.id);
    expect(await asFirm(ids.firmA, (tx) => tx.platformLegalDocument.count(where))).toBe(1);
    expect(
      await outcome(
        asFirm(ids.firmA, (tx) =>
          tx.platformLegalDocument.create({
            data: { kind: 'ACCEPTABLE_USE', version: d.version + 1, title: 'Mine', body: 'x' },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('platform legal acceptances', () => {
  const published = async () =>
    asAdmin((tx) =>
      tx.platformLegalDocument.findFirstOrThrow({
        where: { kind: 'ACCEPTABLE_USE', status: 'PUBLISHED' },
      }),
    );

  it('are of the published version, name a person or an applicant, and are stamped by the database', async () => {
    const doc = await published();
    const accepted = await asPlatform((tx) =>
      tx.platformLegalAcceptance.create({
        data: {
          documentId: doc.id,
          linkedBusinessId: ids.firmA,
          userId: ids.member,
          ipAddress: '203.0.113.7',
          userAgent: 'Test',
          acceptedAt: new Date(0),
        },
      }),
    );
    expect(accepted.acceptedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await outcome(
        asPlatform((tx) => tx.platformLegalAcceptance.create({ data: { documentId: doc.id } })),
      ),
    ).toMatch(/name the person or the firm application/);

    const draftDoc = await draft('DATA_PROCESSING_AGREEMENT');
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformLegalAcceptance.create({
            data: { documentId: draftDoc.id, userId: ids.member },
          }),
        ),
      ),
    ).toMatch(/only the published version/);
    await asAdmin((tx) => tx.platformLegalDocument.delete({ where: { id: draftDoc.id } }));
  });

  it('a firm records and reads only its own; nobody edits or deletes one', async () => {
    const doc = await published();
    const mine = await asFirm(ids.firmA, (tx) =>
      tx.platformLegalAcceptance.create({
        data: { documentId: doc.id, linkedBusinessId: ids.firmA, userId: ids.member },
      }),
    );
    expect(
      await outcome(
        asFirm(ids.firmA, (tx) =>
          tx.platformLegalAcceptance.create({
            data: { documentId: doc.id, linkedBusinessId: ids.firmB, userId: ids.member },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await asFirm(ids.firmB, (tx) => tx.platformLegalAcceptance.count({ where: { id: mine.id } })),
    ).toBe(0);
    expect(
      await asFirm(ids.firmA, (tx) => tx.platformLegalAcceptance.count({ where: { id: mine.id } })),
    ).toBe(1);
    expect(
      await outcome(asAdmin((tx) => tx.platformLegalAcceptance.delete({ where: { id: mine.id } }))),
    ).toMatch(/permission denied/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformLegalAcceptance.update({
            where: { id: mine.id },
            data: { userAgent: 'Edited' },
          }),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});
