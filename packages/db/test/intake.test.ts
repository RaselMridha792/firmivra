// R0 step 6 rules: published forms never change, intake versions lock on submit, Begin Online
// leads hold their intake and uploads until conversion, and a converted upload becomes a
// document with the same S3 key and scan result. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const db = createDatabase(urls.app);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  client1: '',
  client2: '',
  tax: '',
  bookkeeping: '',
  taxEngagement: '',
  taxForm: '',
  bookkeepingForm: '',
  formB: '',
};
const days = (d: number) => new Date(Date.now() + d * 86_400_000);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const firmA = () => db.forBusiness(ids.firmA);
const A = () => ({ businessId: ids.firmA });

const newForm = (data: { serviceId?: string; version: number; published?: boolean }) =>
  firmA().intakeForm.create({
    data: {
      ...A(),
      serviceId: data.serviceId ?? ids.tax,
      version: data.version,
      title: 'Annual Tax intake',
      definition: { steps: [] },
      ...(data.published === false
        ? {}
        : { status: 'PUBLISHED' as const, publishedAt: new Date() }),
    },
  });
const newLead = (data: { serviceId?: string; resumeExpiresAt?: Date } = {}) =>
  firmA().lead.create({
    data: {
      ...A(),
      serviceId: data.serviceId ?? ids.bookkeeping,
      firstName: 'Lena',
      lastName: 'Lead',
      email: `lead-${randomUUID()}@begin.test`,
      ...(data.resumeExpiresAt
        ? { resumeTokenHash: sha(randomUUID()), resumeExpiresAt: data.resumeExpiresAt }
        : {}),
    },
  });
const newUpload = (leadId: string, data: { s3Key?: string } = {}) =>
  firmA().leadUpload.create({
    data: {
      ...A(),
      leadId,
      slot: 'priorReturn',
      fileName: 'return.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256: sha('file'),
      s3Key: data.s3Key ?? `tenant/${ids.firmA}/leads/${randomUUID()}`,
    },
  });
const submitLead = (id: string) =>
  firmA().lead.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
/** Staff convert a submitted lead: a new bookkeeping engagement for client 1. */
const convert = async (leadId: string) => {
  const engagement = await firmA().engagement.create({
    data: { ...A(), clientId: ids.client1, serviceId: ids.bookkeeping, title: 'Bookkeeping' },
  });
  await firmA().lead.update({
    where: { id: leadId },
    data: { status: 'CONVERTED', clientId: ids.client1, engagementId: engagement.id },
  });
  return engagement;
};

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ia-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `ib-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const client = (displayName: string) =>
      tx.client.create({ data: { businessId: ids.firmA, displayName } });
    ids.client1 = (await client('One')).id;
    ids.client2 = (await client('Two')).id;
    const service = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING', name: string) =>
      tx.service.create({ data: { businessId: ids.firmA, kind, name } });
    ids.tax = (await service('ANNUAL_TAX', 'Annual Tax')).id;
    ids.bookkeeping = (await service('BOOKKEEPING', 'Bookkeeping')).id;
    ids.taxEngagement = (
      await tx.engagement.create({
        data: { businessId: ids.firmA, clientId: ids.client1, serviceId: ids.tax, title: '2025' },
      })
    ).id;
    const form = (serviceId: string) =>
      tx.intakeForm.create({
        data: {
          businessId: ids.firmA,
          serviceId,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
    ids.taxForm = (await form(ids.tax)).id;
    ids.bookkeepingForm = (await form(ids.bookkeeping)).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const service = await tx.service.create({
      data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
    });
    ids.formB = (
      await tx.intakeForm.create({
        data: {
          businessId: ids.firmB,
          serviceId: service.id,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('intake forms', () => {
  it('a published version never changes; it can only be retired', async () => {
    const f = await newForm({ version: 10 });
    await expect(
      firmA().intakeForm.update({ where: { id: f.id }, data: { title: 'Edited' } }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      firmA().intakeForm.update({ where: { id: f.id }, data: { publishedAt: null } }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      firmA().intakeForm.update({ where: { id: f.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow(/only be retired/);
    await firmA().intakeForm.update({ where: { id: f.id }, data: { status: 'RETIRED' } });
    await expect(
      firmA().intakeForm.update({ where: { id: f.id }, data: { status: 'PUBLISHED' } }),
    ).rejects.toThrow(/only be retired/);
  });

  it('only a draft can be deleted', async () => {
    const draft = await newForm({ version: 11, published: false });
    const published = await newForm({ version: 12 });
    const remove = async (id: string) =>
      (await firmA().intakeForm.deleteMany({ where: { id } })).count;
    expect(await remove(published.id)).toBe(0);
    expect(await remove(draft.id)).toBe(1);
  });

  it("an intake needs a published form for its engagement's service, from its own firm", async () => {
    const draft = await newForm({ version: 13, published: false });
    const intake = (formId: string) =>
      firmA().intake.create({ data: { ...A(), formId, engagementId: ids.taxEngagement } });
    await expect(intake(draft.id)).rejects.toThrow(/published version/);
    await expect(intake(ids.bookkeepingForm)).rejects.toThrow(/service/);
    // Firm B's form is invisible to firm A (RLS), so it is not a published form here.
    await expect(intake(ids.formB)).rejects.toThrow(/published version/);
    await expect(firmA().intake.create({ data: { ...A(), formId: ids.taxForm } })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(intake(ids.taxForm)).resolves.toMatchObject({ status: 'SENT' });
  });
});

describe('intake versions', () => {
  const newIntake = () =>
    firmA().intake.create({
      data: { ...A(), formId: ids.taxForm, engagementId: ids.taxEngagement },
    });
  const version = (intakeId: string, v: number, data: object = {}) =>
    firmA().intakeSubmission.create({ data: { ...A(), intakeId, version: v, ...data } });

  it('one draft at a time; submitting locks it; versions follow in order', async () => {
    const i = await newIntake();
    const v1 = await version(i.id, 1);
    await expect(version(i.id, 2)).rejects.toThrow(/one draft at a time/);
    await firmA().intakeSubmission.update({
      where: { id: v1.id },
      data: { answers: { fullName: 'Autosaved' } },
    });
    await firmA().intakeSubmission.update({
      where: { id: v1.id },
      data: { submittedAt: new Date() },
    });
    for (const data of [{ answers: { fullName: 'Changed' } }, { submittedAt: null }]) {
      await expect(firmA().intakeSubmission.update({ where: { id: v1.id }, data })).rejects.toThrow(
        /locked/,
      );
    }
    await expect(version(i.id, 3)).rejects.toThrow(/next version must be 2/);
    await expect(version(i.id, 2)).resolves.toMatchObject({ version: 2 });
  });

  it('a signature is a name and a time; IP and browser only with a signature', async () => {
    const i = await newIntake();
    await expect(version(i.id, 1, { signerIp: '203.0.113.5' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(version(i.id, 1, { signedAt: new Date() })).rejects.toThrow(/check constraint/i);
    await expect(
      version(i.id, 1, {
        signerName: 'Lena Lead',
        signedAt: new Date(),
        signerIp: '203.0.113.5',
        submittedAt: new Date(),
      }),
    ).resolves.toMatchObject({ signerIp: '203.0.113.5' });
  });
});

describe('Begin Online leads', () => {
  it('a resume link lasts at most 30 days, by the database clock', async () => {
    await expect(newLead({ resumeExpiresAt: days(31) })).rejects.toThrow(/at most 30 days/);
    await expect(newLead({ resumeExpiresAt: days(30) })).resolves.toMatchObject({
      status: 'DRAFT',
    });
  });

  it('checks email case, submission time and a reason to decline', async () => {
    await expect(
      firmA().lead.create({
        data: {
          ...A(),
          serviceId: ids.bookkeeping,
          firstName: 'A',
          lastName: 'B',
          email: 'Mixed@Begin.test',
        },
      }),
    ).rejects.toThrow(/check constraint/i);
    const lead = await newLead();
    await expect(
      firmA().lead.update({ where: { id: lead.id }, data: { status: 'SUBMITTED' } }),
    ).rejects.toThrow(/check constraint/i);
    await submitLead(lead.id);
    await expect(
      firmA().lead.update({ where: { id: lead.id }, data: { status: 'DECLINED' } }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('uploads go under the firm prefix, only while the lead is a draft', async () => {
    const lead = await newLead();
    await expect(
      newUpload(lead.id, { s3Key: `tenant/${ids.firmB}/leads/${randomUUID()}` }),
    ).rejects.toThrow(/check constraint/i);
    const upload = await newUpload(lead.id);
    await submitLead(lead.id);
    await expect(newUpload(lead.id)).rejects.toThrow(/only while the lead is a draft/);
    expect((await firmA().leadUpload.deleteMany({ where: { id: upload.id } })).count).toBe(0);
  });

  it('a draft upload can be deleted; its file and scan result never change', async () => {
    const lead = await newLead();
    const upload = await newUpload(lead.id);
    await expect(
      firmA().leadUpload.update({ where: { id: upload.id }, data: { sha256: sha('other') } }),
    ).rejects.toThrow(/cannot change/);
    await firmA().leadUpload.update({
      where: { id: upload.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    await expect(
      firmA().leadUpload.update({ where: { id: upload.id }, data: { scanStatus: 'INFECTED' } }),
    ).rejects.toThrow(/cannot change/);
    expect((await firmA().leadUpload.deleteMany({ where: { id: upload.id } })).count).toBe(1);
  });
});

describe('converting a lead', () => {
  it("sets the client and an engagement of the lead's service, once and for good", async () => {
    const lead = await newLead();
    await submitLead(lead.id);
    const wrongService = await firmA().engagement.create({
      data: { ...A(), clientId: ids.client1, serviceId: ids.tax, title: 'Tax' },
    });
    await expect(
      firmA().lead.update({
        where: { id: lead.id },
        data: { status: 'CONVERTED', clientId: ids.client1, engagementId: wrongService.id },
      }),
    ).rejects.toThrow(/service of the lead/);
    // The engagement must belong to the client named on the lead.
    const client1Bookkeeping = await firmA().engagement.create({
      data: { ...A(), clientId: ids.client1, serviceId: ids.bookkeeping, title: 'Bookkeeping' },
    });
    await expect(
      firmA().lead.update({
        where: { id: lead.id },
        data: { status: 'CONVERTED', clientId: ids.client2, engagementId: client1Bookkeeping.id },
      }),
    ).rejects.toThrow(/foreign key/i);

    await convert(lead.id);
    await expect(
      firmA().lead.update({ where: { id: lead.id }, data: { status: 'IN_REVIEW' } }),
    ).rejects.toThrow(/stays converted/);
  });

  it("the lead's intake gets the converted engagement once", async () => {
    const lead = await newLead();
    const intake = await firmA().intake.create({
      data: { ...A(), formId: ids.bookkeepingForm, leadId: lead.id },
    });
    const early = await firmA().engagement.create({
      data: { ...A(), clientId: ids.client1, serviceId: ids.bookkeeping, title: 'Early' },
    });
    const setEngagement = (engagementId: string) =>
      firmA().intake.update({ where: { id: intake.id }, data: { engagementId } });
    await expect(setEngagement(early.id)).rejects.toThrow(/set once, from the converted lead/);

    await submitLead(lead.id);
    const engagement = await convert(lead.id);
    await expect(setEngagement(engagement.id)).resolves.toMatchObject({
      engagementId: engagement.id,
      leadId: lead.id,
    });
    await expect(setEngagement(early.id)).rejects.toThrow(/set once/);
  });

  it('a carried-over upload becomes a document with the same key, file and scan result', async () => {
    const lead = await newLead();
    const upload = await newUpload(lead.id);
    const scannedAt = new Date();
    await firmA().leadUpload.update({
      where: { id: upload.id },
      data: { scanStatus: 'CLEAN', scannedAt },
    });
    await submitLead(lead.id);
    const engagement = await convert(lead.id);

    const carry = (data: { sha256?: string; leadUploadId?: string | null } = {}) =>
      firmA().document.create({
        data: {
          ...A(),
          clientId: ids.client1,
          engagementId: engagement.id,
          leadUploadId: upload.id,
          direction: 'CLIENT_TO_FIRM',
          fileName: upload.fileName,
          contentType: upload.contentType,
          sizeBytes: upload.sizeBytes,
          sha256: upload.sha256,
          s3Key: upload.s3Key,
          scanStatus: 'CLEAN',
          scannedAt,
          ...data,
        },
      });
    await expect(carry({ sha256: sha('tampered') })).rejects.toThrow(/carried-over upload/);
    // Without a lead upload, a document may not start already scanned.
    await expect(carry({ leadUploadId: null })).rejects.toThrow(/starts unscanned/);
    await expect(carry()).resolves.toMatchObject({ s3Key: upload.s3Key, scanStatus: 'CLEAN' });
    await expect(carry()).rejects.toThrow(/unique constraint/i);
  });
});
