// Q35 (Nov 25): the platform acquisition CRM tables (consent, nurture journeys, demos). Platform
// data like the rest of sales_*: the Super Admin team writes it in admin scope, no firm scope
// reads or writes it. A published journey version never changes; an enrollment follows a
// version of its own journey.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { admin: randomUUID(), firm: '' };

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId: ids.admin }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const contact = (name: string) =>
  asAdmin((tx) =>
    tx.salesContact.create({ data: { name, email: `q35-${randomUUID()}@example.test` } }),
  );

/** A journey with a published version 1 and a draft version 2. */
async function journey() {
  return asAdmin(async (tx) => {
    const j = await tx.salesNurtureJourney.create({ data: { name: `Fake journey ${run}` } });
    const v1 = await tx.salesNurtureJourneyVersion.create({
      data: {
        journeyId: j.id,
        version: 1,
        steps: [{ delayDays: 1, channel: 'EMAIL' }],
        publishedAt: new Date(),
      },
    });
    const v2 = await tx.salesNurtureJourneyVersion.create({
      data: { journeyId: j.id, version: 2, steps: [] },
    });
    return { j, v1, v2 };
  });
}

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: ids.admin,
        cognitoSub: ids.admin,
        pool: 'ADMIN',
        email: `${ids.admin}@sup.test`,
        name: 'Fake',
      },
    });
    await tx.platformAdmin.create({ data: { userId: ids.admin, role: 'SUPER_ADMIN' } });
    ids.firm = (
      await tx.business.create({ data: { name: `Q35 Fake Firm ${run}`, slug: `q35-crm-${run}` } })
    ).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

describe('Q35 CRM schema', () => {
  it('keeps one consent row per contact, written in admin scope', async () => {
    const c = await contact('Fake Lead');
    const row = await asAdmin((tx) =>
      tx.salesLeadConsent.create({
        data: {
          contactId: c.id,
          consented: true,
          consentedAt: new Date(),
          consentSource: 'manual',
        },
      }),
    );
    expect(row).toMatchObject({ contactId: c.id, consented: true, suppressed: false });
    expect(
      await outcome(asAdmin((tx) => tx.salesLeadConsent.create({ data: { contactId: c.id } }))),
    ).toMatch(/Unique constraint/);
  });

  it('no firm scope reads or writes any CRM table', async () => {
    const c = await contact('Fake Hidden Lead');
    const { j } = await journey();
    await asAdmin((tx) => tx.salesDemoRequest.create({ data: { contactId: c.id } }));
    await asFirm(async (tx) => {
      expect(await tx.salesLeadConsent.count()).toBe(0);
      expect(await tx.salesNurtureJourney.count()).toBe(0);
      expect(await tx.salesNurtureJourneyVersion.count()).toBe(0);
      expect(await tx.salesNurtureEnrollment.count()).toBe(0);
      expect(await tx.salesNurtureExecution.count()).toBe(0);
      expect(await tx.salesDemoRequest.count()).toBe(0);
      expect(await tx.salesDemoAppointment.count()).toBe(0);
    });
    expect(
      await outcome(asFirm((tx) => tx.salesNurtureJourney.create({ data: { name: 'Fake' } }))),
    ).toMatch(/row-level security/);
    expect(
      await outcome(
        asFirm((tx) =>
          tx.salesNurtureJourneyVersion.create({
            data: { journeyId: j.id, version: 9, steps: [] },
          }),
        ),
      ),
    ).not.toBe('ok');
  });

  it('a published version never changes; a draft does', async () => {
    const { v1, v2 } = await journey();
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.salesNurtureJourneyVersion.update({ where: { id: v1.id }, data: { steps: [] } }),
        ),
      ),
    ).toMatch(/published journey version cannot change/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.salesNurtureJourneyVersion.update({
            where: { id: v2.id },
            data: { steps: [{ delayDays: 2, channel: 'EMAIL' }] },
          }),
        ),
      ),
    ).toBe('ok');
  });

  it('a journey points only at a published version of its own', async () => {
    const { j, v1, v2 } = await journey();
    const other = await journey();
    const set = (versionId: string) =>
      outcome(
        asAdmin((tx) =>
          tx.salesNurtureJourney.update({
            where: { id: j.id },
            data: { currentVersionId: versionId },
          }),
        ),
      );
    expect(await set(v2.id)).toMatch(/must be published/);
    expect(await set(other.v1.id)).toMatch(/Foreign key constraint/);
    expect(await set(v1.id)).toBe('ok');
  });

  it('an enrollment follows a version of its own journey, once per contact', async () => {
    const c = await contact('Fake Enrolled Lead');
    const { j, v1 } = await journey();
    const other = await journey();
    const enroll = (versionId: string) =>
      outcome(
        asAdmin((tx) =>
          tx.salesNurtureEnrollment.create({
            data: { journeyId: j.id, versionId, contactId: c.id, enrolledByUserId: ids.admin },
          }),
        ),
      );
    expect(await enroll(other.v1.id)).toMatch(/Foreign key constraint/);
    expect(await enroll(v1.id)).toBe('ok');
    expect(await enroll(v1.id)).toMatch(/Unique constraint/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.salesNurtureEnrollment.updateMany({
            where: { journeyId: j.id },
            data: { status: 'STOPPED' },
          }),
        ),
      ),
    ).toMatch(/sales_nurture_enrollments_stopped/);
  });

  it('a demo request holds appointments of 5 to 480 minutes', async () => {
    const c = await contact('Fake Demo Lead');
    const req = await asAdmin((tx) =>
      tx.salesDemoRequest.create({ data: { contactId: c.id, topic: 'Platform demo' } }),
    );
    const book = (durationMinutes: number) =>
      outcome(
        asAdmin((tx) =>
          tx.salesDemoAppointment.create({
            data: { requestId: req.id, scheduledAt: new Date(), durationMinutes },
          }),
        ),
      );
    expect(await book(4)).toMatch(/sales_demo_appointments_values/);
    expect(await book(30)).toBe('ok');
    expect(
      await asAdmin((tx) => tx.salesDemoAppointment.count({ where: { requestId: req.id } })),
    ).toBe(1);
  });
});
