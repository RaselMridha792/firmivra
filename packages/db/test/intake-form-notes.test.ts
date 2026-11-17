// Intake Forms Review 2 (R1, migration r1_intake_notes_share_version, the lead's approval of Nov 17
// under Rasel's delegation): the firm's notes on an assigned form, its own firm's only, with words
// and a real member as author; and a share link generation that starts at 0 and is never
// negative. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { expectInvisibleToOtherFirm } from './r36-helpers.js';
import { failure } from './r38-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const unscopedApp = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);
const run = randomUUID().slice(0, 8);
const firm = { a: '', b: '' };
const user = { a: randomUUID(), b: randomUUID(), outsider: randomUUID() };
const intake = { a: '', b: '' };
const service = { a: '' };

/** A firm with a member, a client and one sent form of a published version. */
async function seed(key: 'a' | 'b') {
  return runInScope(owner, { kind: 'business', businessId: firm[key] }, async (tx) => {
    const businessId = firm[key];
    await tx.membership.create({
      data: { businessId, userId: user[key], role: 'STAFF', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { businessId, displayName: 'Fake' } });
    const s = await tx.service.create({ data: { businessId, kind: 'ANNUAL_TAX', name: 'Tax' } });
    const e = await tx.engagement.create({
      data: { businessId, clientId: client.id, serviceId: s.id, title: 'Tax' },
    });
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: s.id,
        version: 1,
        title: 'Intake',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const i = await tx.intake.create({
      data: { businessId, formId: form.id, engagementId: e.id },
    });
    return { intake: i.id, service: s.id };
  });
}

const note = (key: 'a' | 'b', data: { body?: string; authorUserId?: string; intakeId?: string }) =>
  db.forBusiness(firm[key]).intakeFormNote.create({
    data: {
      businessId: firm[key],
      intakeId: data.intakeId ?? intake[key],
      authorUserId: data.authorUserId ?? user[key],
      body: data.body ?? 'Called the client about the missing W-2 (fake).',
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(user)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@notes.test`, name: 'Fake' },
      });
    }
    firm.a = (await tx.business.create({ data: { slug: `ifn-a-${run}`, name: 'A' } })).id;
    firm.b = (await tx.business.create({ data: { slug: `ifn-b-${run}`, name: 'B' } })).id;
  });
  const a = await seed('a');
  intake.a = a.intake;
  service.a = a.service;
  intake.b = (await seed('b')).intake;
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), unscopedApp.$disconnect(), db.disconnect()]);
});

describe('intake_form_notes', () => {
  it("keeps a firm's notes from every other firm", async () => {
    const made = await note('a', {});
    expect(made).toMatchObject({ intakeId: intake.a, authorUserId: user.a });
    await note('b', {});
    await expectInvisibleToOtherFirm(unscopedApp, firm.a, firm.b, ['intake_form_notes']);
    // Firm B can't write a note into firm A, nor on firm A's form.
    expect(
      await failure(
        db.forBusiness(firm.b).intakeFormNote.create({
          data: { businessId: firm.a, intakeId: intake.a, authorUserId: user.a, body: 'x' },
        }),
      ),
    ).toMatch(/row-level security/i);
    expect(await failure(note('b', { intakeId: intake.a }))).toMatch(/foreign key/i);
  });

  it('a note has words (1 to 2000, no hidden characters) and a member of the firm as author', async () => {
    for (const body of ['', '   ', 'x'.repeat(2001), 'hidden​space']) {
      expect(await failure(note('a', { body })), JSON.stringify(body)).toMatch(/check constraint/i);
    }
    expect((await note('a', { body: 'x'.repeat(2000) })).body).toHaveLength(2000);
    expect(await failure(note('a', { authorUserId: user.outsider }))).toMatch(/foreign key/i);
  });
});

describe('intake_templates.share_link_version', () => {
  it('starts at 0, counts up on a rotation, and is never negative', async () => {
    const t = await db.forBusiness(firm.a).intakeTemplate.create({
      data: { businessId: firm.a, serviceId: service.a },
    });
    expect(t.shareLinkVersion).toBe(0);
    const rotated = await db.forBusiness(firm.a).intakeTemplate.update({
      where: { id: t.id },
      data: { shareLinkVersion: { increment: 1 } },
    });
    expect(rotated.shareLinkVersion).toBe(1);
    expect(
      await failure(
        db.forBusiness(firm.a).intakeTemplate.update({
          where: { id: t.id },
          data: { shareLinkVersion: -1 },
        }),
      ),
    ).toMatch(/check constraint/i);
  });
});
