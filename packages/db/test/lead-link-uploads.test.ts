// R55 item n (migration r55_lead_link_uploads, approved by the lead under Rasel's delegation,
// Nov 14): a lead's own files through the secure intake link. lead_uploads.intake_id is set only on
// the lead's own file, for the lead's open intake with a live link; it never changes; the lead may
// remove such a file only while the intake is open. Runs as the app role under RLS. Synthetic
// data only.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
const ids = { serviceA: '', formA: '', serviceB: '', formB: '' };

/** An open lead (CONTACTED) of the firm, for its service. */
async function newLead(firm: 'a' | 'b', extra: object = {}): Promise<string> {
  const businessId = firm === 'a' ? f.firmA : f.firmB;
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const lead = await tx.lead.create({
      data: {
        businessId,
        serviceId: firm === 'a' ? ids.serviceA : ids.serviceB,
        firstName: 'Fake',
        lastName: 'Lead',
        email: `l-${randomUUID()}@r55lu.test`,
        status: 'CONTACTED',
        submittedAt: new Date(),
        ...extra,
      },
    });
    return lead.id;
  });
}

/** A sent intake of the lead with a live secure link (48 hours). */
async function linkIntake(firm: 'a' | 'b', leadId: string, extra: object = {}): Promise<string> {
  const businessId = firm === 'a' ? f.firmA : f.firmB;
  const intake = await (firm === 'a' ? A() : B()).intake.create({
    data: {
      businessId,
      formId: firm === 'a' ? ids.formA : ids.formB,
      leadId,
      accessTokenHash: sha(randomUUID()),
      accessTokenExpiresAt: hours(48),
      ...extra,
    },
  });
  return intake.id;
}

const file = (leadId: string, intakeId: string | null, extra: object = {}) => ({
  businessId: f.firmA,
  leadId,
  intakeId,
  slot: 'priorReturn',
  fileName: 'return.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  sha256: sha(randomUUID()),
  s3Key: `tenant/${f.firmA}/leads/${randomUUID()}`,
  ...extra,
});

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r55lu');
  for (const [key, businessId] of [
    ['A', f.firmA],
    ['B', f.firmB],
  ] as const) {
    const made = await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID().slice(0, 6)}` },
      });
      const form = await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: service.id,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      return { service: service.id, form: form.id };
    });
    ids[`service${key}`] = made.service;
    ids[`form${key}`] = made.form;
  }
});

describe('a lead file through the secure link', () => {
  it("is taken for the lead's open intake with a live link, and its intake never changes", async () => {
    const lead = await newLead('a');
    const intake = await linkIntake('a', lead);
    const made = await A().leadUpload.create({ data: file(lead, intake) });
    expect(made).toMatchObject({ intakeId: intake, uploadedByUserId: null, scanStatus: 'PENDING' });
    // The scan result is still written; the intake is not moved or cleared.
    await expect(
      A().leadUpload.update({
        where: { id: made.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      }),
    ).resolves.toMatchObject({ scanStatus: 'CLEAN' });
    const other = await linkIntake('a', lead);
    for (const intakeId of [other, null]) {
      expect(
        await failure(A().leadUpload.update({ where: { id: made.id }, data: { intakeId } })),
      ).toMatch(/cannot change/);
    }
  });

  it('is refused once the link or the intake is closed, or for another lead', async () => {
    const lead = await newLead('a');
    // The link expired.
    const expired = await linkIntake('a', lead);
    await A().intake.update({ where: { id: expired }, data: { accessTokenExpiresAt: hours(-1) } });
    expect(await failure(A().leadUpload.create({ data: file(lead, expired) }))).toMatch(
      /open intake with a live link/,
    );
    // The intake is no longer open. (One past its own expiry can't be built here: an intake's
    // expiry comes after its send, which the database dates now.)
    const closed = await linkIntake('a', lead, { status: 'EXPIRED' });
    expect(await failure(A().leadUpload.create({ data: file(lead, closed) }))).toMatch(
      /open intake with a live link/,
    );
    // Another lead's intake.
    const someoneElse = await newLead('a');
    const theirs = await linkIntake('a', someoneElse);
    expect(await failure(A().leadUpload.create({ data: file(lead, theirs) }))).toMatch(
      /open intake with a live link/,
    );
    // An archived or converted lead.
    const archived = await newLead('a', { archivedAt: new Date(), archivedByUserId: f.memberA });
    const archivedIntake = await linkIntake('a', archived);
    expect(await failure(A().leadUpload.create({ data: file(archived, archivedIntake) }))).toMatch(
      /open intake with a live link/,
    );
  });

  it('is never a staff file, and its slot is an intake key', async () => {
    const lead = await newLead('a');
    const intake = await linkIntake('a', lead);
    expect(
      await failure(
        A().leadUpload.create({
          data: file(lead, intake, { slot: 'staff', uploadedByUserId: f.memberA }),
        }),
      ),
    ).toMatch(/lead_uploads_intake_link/);
    for (const slot of ['Prior return', '1st', 'constructor']) {
      expect(await failure(A().leadUpload.create({ data: file(lead, intake, { slot }) }))).toMatch(
        /lead_uploads_intake_link/,
      );
    }
    // Staff files and Begin Online files keep their own rules.
    await expect(
      A().leadUpload.create({
        data: file(lead, null, { slot: 'staff', uploadedByUserId: f.memberA }),
      }),
    ).resolves.toMatchObject({ intakeId: null });
    expect(await failure(A().leadUpload.create({ data: file(lead, null) }))).toMatch(
      /only while the lead is a draft/,
    );
  });

  it('is removed by the lead only while the intake is open', async () => {
    const lead = await newLead('a');
    const intake = await linkIntake('a', lead);
    const first = await A().leadUpload.create({ data: file(lead, intake) });
    const second = await A().leadUpload.create({ data: file(lead, intake) });
    await A().leadUpload.delete({ where: { id: first.id } });
    expect(await A().leadUpload.findUnique({ where: { id: first.id } })).toBeNull();
    await A().intake.update({ where: { id: intake }, data: { status: 'UNDER_REVIEW' } });
    const left = await A().leadUpload.deleteMany({ where: { id: second.id } });
    expect(left.count).toBe(0);
  });

  it("refuses another firm's intake, and another firm sees none of them", async () => {
    const lead = await newLead('a');
    const leadB = await newLead('b');
    const intakeB = await linkIntake('b', leadB);
    expect(await failure(A().leadUpload.create({ data: file(lead, intakeB) }))).toMatch(
      /foreign key|open intake with a live link/,
    );
    const intake = await linkIntake('a', lead);
    const mine = await A().leadUpload.create({ data: file(lead, intake) });
    expect(await B().leadUpload.findUnique({ where: { id: mine.id } })).toBeNull();
    expect((await B().leadUpload.deleteMany({ where: { id: mine.id } })).count).toBe(0);
    expect(await A().leadUpload.findUnique({ where: { id: mine.id } })).not.toBeNull();
  });
});
