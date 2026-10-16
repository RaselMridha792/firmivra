// R37, Intake Forms: templates. A service can have several; the versions are intake_forms rows
// numbered per template; the database files a form without a template under the service's default.
// Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  staffB: randomUUID(),
  tax: '',
  bookkeeping: '',
  taxB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);

const newForm = (data: {
  serviceId?: string;
  templateId?: string;
  version: number;
  status?: 'DRAFT' | 'PUBLISHED';
}) =>
  A().intakeForm.create({
    data: {
      businessId: ids.firmA,
      serviceId: data.serviceId ?? ids.tax,
      title: 'Intake',
      version: data.version,
      ...(data.templateId ? { templateId: data.templateId } : {}),
      ...(data.status === 'DRAFT' ? {} : { status: 'PUBLISHED', publishedAt: new Date() }),
    },
  });
const newTemplate = (data: { serviceId?: string; serviceDefault?: boolean } = {}) =>
  A().intakeTemplate.create({
    data: { businessId: ids.firmA, serviceId: data.serviceId ?? ids.tax, ...data },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@it.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ita-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `itb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.staffA, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING', name: string) =>
      tx.service.create({ data: { businessId: ids.firmA, kind, name } });
    ids.tax = (await service('ANNUAL_TAX', 'Annual Tax')).id;
    ids.bookkeeping = (await service('BOOKKEEPING', 'Bookkeeping')).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.taxB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's templates, and refuses to point at them", async () => {
    const template = await newTemplate();
    expect(await B().intakeTemplate.findUnique({ where: { id: template.id } })).toBeNull();
    expect(
      (
        await B().intakeTemplate.updateMany({
          where: { id: template.id },
          data: { internalNotes: 'x' },
        })
      ).count,
    ).toBe(0);
    await expect(
      B().intakeTemplate.create({ data: { businessId: ids.firmA, serviceId: ids.tax } }),
    ).rejects.toThrow(/row-level security/i);
    // Firm B's own template naming firm A's service or member: the same-firm foreign keys.
    await expect(
      B().intakeTemplate.create({ data: { businessId: ids.firmB, serviceId: ids.tax } }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().intakeTemplate.create({
        data: { businessId: ids.firmB, serviceId: ids.taxB, createdByUserId: ids.staffA },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().intakeForm.create({
        data: {
          businessId: ids.firmB,
          serviceId: ids.taxB,
          templateId: template.id,
          version: 1,
          title: 'x',
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('templates and their versions', () => {
  it('files a form without a template under the default template of its service', async () => {
    const first = await newForm({ serviceId: ids.bookkeeping, version: 1 });
    expect(first.templateId).not.toBeNull();
    const template = await A().intakeTemplate.findUniqueOrThrow({
      where: { id: first.templateId! },
    });
    expect(template).toMatchObject({
      serviceId: ids.bookkeeping,
      serviceDefault: true,
      createdByUserId: null,
    });
    const second = await newForm({ serviceId: ids.bookkeeping, version: 2 });
    expect(second.templateId).toBe(first.templateId);
    // The same version number again in the same template is refused, as before.
    await expect(newForm({ serviceId: ids.bookkeeping, version: 2 })).rejects.toThrow(/Unique/i);
  });

  it('a service can have several templates, each numbering its own versions', async () => {
    const other = await newTemplate({ serviceId: ids.tax });
    const one = await newForm({ templateId: other.id, version: 1 });
    const two = await newForm({ version: 1 });
    expect(one.templateId).toBe(other.id);
    expect(two.templateId).not.toBe(other.id);
    await expect(newForm({ templateId: other.id, version: 1 })).rejects.toThrow(/Unique/i);
  });

  it("a version's template is of the same service", async () => {
    const bookkeeping = await newTemplate({ serviceId: ids.bookkeeping });
    await expect(newForm({ templateId: bookkeeping.id, version: 1 })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it('has one live default per service, and a default is never archived', async () => {
    const service = (
      await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.service.create({
          data: { businessId: ids.firmA, kind: 'PAYROLL', name: `Payroll ${run}` },
        }),
      )
    ).id;
    const first = await newTemplate({ serviceId: service, serviceDefault: true });
    await expect(newTemplate({ serviceId: service, serviceDefault: true })).rejects.toThrow(
      /Unique/i,
    );
    await expect(
      A().intakeTemplate.update({ where: { id: first.id }, data: { archivedAt: new Date() } }),
    ).rejects.toThrow(/intake_templates_default_live/);
    await A().intakeTemplate.update({
      where: { id: first.id },
      data: { serviceDefault: false, archivedAt: new Date() },
    });
    // With the default archived, the next form gets a new default template.
    const form = await newForm({ serviceId: service, version: 1 });
    expect(form.templateId).not.toBe(first.id);
  });
});

describe('template rules', () => {
  it('keeps notes short, and the service and maker fixed', async () => {
    await expect(
      A().intakeTemplate.create({
        data: { businessId: ids.firmA, serviceId: ids.tax, internalNotes: 'x'.repeat(501) },
      }),
    ).rejects.toThrow(/intake_templates_internal_notes/);
    const template = await newTemplate();
    await expect(
      A().intakeTemplate.update({
        where: { id: template.id },
        data: { serviceId: ids.bookkeeping },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      A().intakeTemplate.update({
        where: { id: template.id },
        data: { createdByUserId: ids.staffA },
      }),
    ).rejects.toThrow(/cannot change/);
  });

  it('is archived for good and takes no new version; its published versions keep it', async () => {
    const template = await newTemplate();
    const published = await newForm({ templateId: template.id, version: 1 });
    const archivedAt = new Date();
    await A().intakeTemplate.update({ where: { id: template.id }, data: { archivedAt } });
    await expect(
      A().intakeTemplate.update({ where: { id: template.id }, data: { archivedAt: null } }),
    ).rejects.toThrow(/stays archived/);
    await expect(newForm({ templateId: template.id, version: 2 })).rejects.toThrow(
      /archived template takes no new version/,
    );
    const other = await newTemplate();
    await expect(
      A().intakeForm.update({ where: { id: published.id }, data: { templateId: other.id } }),
    ).rejects.toThrow(/template of a published version cannot change/);
  });

  it('is never deleted', async () => {
    const template = await newTemplate();
    await expect(A().intakeTemplate.delete({ where: { id: template.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});
