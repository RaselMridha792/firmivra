// r0_staff_import_previews: R55's Import Staff preview rows. A firm sees only its own previews,
// the database gives each an hour (an expired one is no longer read and is cleaned up), the rows
// are a JSON array with no secret keys, and a preview is never edited. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const u = { owner: randomUUID(), other: randomUUID() };
const ids = { firmA: '', firmB: '', owner: '', other: '' };
const firmA = () => db.forBusiness(ids.firmA);
const firmB = () => db.forBusiness(ids.firmB);
const ROWS = [
  { firstName: 'Avery', lastName: 'Fake', email: 'avery@fake.test', role: 'STAFF' },
  { firstName: 'Jordan', lastName: 'Fake', email: 'jordan@fake.test', role: 'ADMIN' },
];
const preview = (rows: unknown = ROWS, extra: Record<string, unknown> = {}) =>
  firmA().staffImportPreview.create({
    data: { businessId: ids.firmA, createdById: ids.owner, rows: rows as never, ...extra },
  });
/** Moves a preview's expiry into the past, as the owner (the app can't edit a preview). */
const expire = (id: string) =>
  owner.$executeRaw`UPDATE staff_import_previews SET expires_at = now() - interval '1 minute' WHERE id = ${id}::uuid`;
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(u)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ia-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `ib-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.owner = (
      await tx.membership.create({
        data: { businessId: ids.firmA, userId: u.owner, role: 'OWNER', status: 'ACTIVE' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.other = (
      await tx.membership.create({
        data: { businessId: ids.firmB, userId: u.other, role: 'OWNER', status: 'ACTIVE' },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('staff import previews', () => {
  it('expire an hour after creation, whatever the app sends', async () => {
    const before = Date.now();
    const p = await preview(ROWS, { expiresAt: new Date(Date.now() + 30 * 86_400_000) });
    const hour = p.expiresAt.getTime() - p.createdAt.getTime();
    expect(hour).toBe(3_600_000);
    expect(p.createdAt.getTime()).toBeGreaterThan(before - 60_000);
    expect(p.rows).toEqual(ROWS);
  });

  it('a firm sees only its own previews, and writes none for another firm', async () => {
    const p = await preview();
    expect(await firmB().staffImportPreview.findUnique({ where: { id: p.id } })).toBeNull();
    expect(await firmA().staffImportPreview.findUnique({ where: { id: p.id } })).not.toBeNull();
    expect(
      await outcome(
        firmB().staffImportPreview.create({
          data: { businessId: ids.firmA, createdById: ids.owner, rows: ROWS },
        }),
      ),
    ).toMatch(/row-level security/);
    // Another firm's member can't be the creator (the composite key keeps it in the firm).
    expect(
      await outcome(
        firmA().staffImportPreview.create({
          data: { businessId: ids.firmA, createdById: ids.other, rows: ROWS },
        }),
      ),
    ).toMatch(/Foreign key|foreign key/);
    expect((await firmB().staffImportPreview.deleteMany({ where: { id: p.id } })).count).toBe(0);
  });

  it('an expired preview is no longer read', async () => {
    const p = await preview();
    await expire(p.id);
    expect(await firmA().staffImportPreview.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it("the firm's next preview deletes its expired ones, and only its own", async () => {
    const old = await preview();
    const otherFirm = await firmB().staffImportPreview.create({
      data: { businessId: ids.firmB, createdById: ids.other, rows: ROWS },
    });
    await expire(old.id);
    await expire(otherFirm.id);
    await preview();
    const left = await owner.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM staff_import_previews WHERE id IN (${old.id}::uuid, ${otherFirm.id}::uuid)`;
    expect(left.map((r) => r.id)).toEqual([otherFirm.id]);
  });

  it("the purge deletes every firm's expired previews and nothing else", async () => {
    const live = await preview();
    const gone = await firmB().staffImportPreview.create({
      data: { businessId: ids.firmB, createdById: ids.other, rows: ROWS },
    });
    await expire(gone.id);
    // The app role calls it (from firm A's scope here); it still reaches firm B's expired row.
    const [{ n }] = await runInScope(
      app,
      { kind: 'business', businessId: ids.firmA },
      (tx) => tx.$queryRaw<[{ n: number }]>`SELECT app_purge_expired_staff_import_previews() AS n`,
    );
    expect(n).toBeGreaterThanOrEqual(1);
    const left = await owner.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM staff_import_previews WHERE id IN (${live.id}::uuid, ${gone.id}::uuid)`;
    expect(left.map((r) => r.id)).toEqual([live.id]);
  });

  it('holds a JSON array of up to 1,000 rows, with no password, token, secret or SSN keys', async () => {
    for (const bad of [
      { firstName: 'Not an array' },
      [],
      Array.from({ length: 1001 }, (_, i) => ({ email: `p${i}@fake.test` })),
      [{ firstName: 'Fake', password: 'x' }],
      [{ firstName: 'Fake', profile: { apiToken: 'x' } }],
      [{ firstName: 'Fake', SSN: '000-00-0000' }],
    ]) {
      expect(await outcome(preview(bad))).toMatch(/staff_import_previews_rules/);
    }
    expect(await outcome(preview([{ firstName: 'Fake', requirePasswordChange: true }]))).toBe('ok');
  });

  it('is never edited; the firm discards it', async () => {
    const p = await preview();
    expect(
      await outcome(
        firmA().staffImportPreview.update({ where: { id: p.id }, data: { rows: [{ a: 1 }] } }),
      ),
    ).toMatch(/permission denied/);
    await firmA().staffImportPreview.delete({ where: { id: p.id } });
    expect(await firmA().staffImportPreview.findUnique({ where: { id: p.id } })).toBeNull();
  });
});
