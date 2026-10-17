// Reusable seed helpers shared by seed.ts (LVP, Test Firm B) and the demo seed (seed-demo-*.ts). A
// plain module, never run on its own: importing anything from seed.ts itself would execute its
// top-level main() as a side effect, so these live here instead.
import { createHash } from 'node:crypto';
import { INTAKE_FORMS } from '@firmivra/types';
import type { TxClient } from '../src/client.js';
import {
  SAMPLE_AGREEMENT,
  seedFormDefinition,
  type SEED_APPOINTMENT_TYPES,
  type SEED_DOCUMENT_CATEGORIES,
  type SEED_SERVICES,
} from './seed-data.js';

export async function seedFirmBasics(
  tx: TxClient,
  businessId: string,
  firm: {
    name: string;
    ownerId: string;
    contactEmail: string;
    brandColor?: string;
    taxStatuses: readonly string[];
  },
) {
  await tx.businessSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      contactEmail: firm.contactEmail,
      brandColor: firm.brandColor ?? null,
      setupCompletedAt: new Date(),
    },
  });
  for (const [kind, title] of [
    ['TERMS', 'Terms of Service'],
    ['PRIVACY', 'Privacy Policy'],
  ] as const) {
    await tx.firmLegalDocument.upsert({
      where: { businessId_kind_version: { businessId, kind, version: 1 } },
      update: {},
      create: {
        businessId,
        kind,
        version: 1,
        body: `# ${firm.name}: ${title}\n\nSample text for local development. Not legal text.`,
        publishedByUserId: firm.ownerId,
      },
    });
  }
  for (const [sortOrder, name] of firm.taxStatuses.entries()) {
    await tx.taxStatus.upsert({
      where: { businessId_name: { businessId, name } },
      update: { sortOrder },
      create: { businessId, name, sortOrder },
    });
  }
}

/** The firm's client record and profile for a seeded client login, linked to that login. */
export async function seedClient(
  tx: TxClient,
  businessId: string,
  clientId: string,
  user: { id: string; email: string; name: string },
  assignedUserId: string,
) {
  const [firstName, lastName] = user.name.split(' ');
  await tx.client.upsert({
    where: { id: clientId },
    update: {},
    create: { id: clientId, businessId, displayName: user.name, email: user.email, assignedUserId },
  });
  await tx.clientProfile.upsert({
    where: { clientId },
    update: {},
    create: { clientId, businessId, firstName: firstName ?? null, lastName: lastName ?? null },
  });
  await tx.clientAccount.update({ where: { userId: user.id }, data: { clientId } });
}

/** The firm's services; returns their ids by name. */
export async function seedServices(
  tx: TxClient,
  businessId: string,
  services: (typeof SEED_SERVICES)[keyof typeof SEED_SERVICES],
) {
  const ids = new Map<string, string>();
  for (const [sortOrder, s] of services.entries()) {
    const data = {
      kind: s.kind,
      billingInterval: s.billingInterval,
      packages: [...s.packages],
      stages: [...s.stages],
      sortOrder,
      // Every seeded service is offered on Begin Online: one per kind, none OTHER.
      beginOnline: true,
    };
    const row = await tx.service.upsert({
      where: { businessId_name: { businessId, name: s.name } },
      update: data,
      create: { businessId, name: s.name, ...data },
    });
    ids.set(s.name, row.id);
  }
  return byName('service', ids);
}

/** The firm's document categories; returns their ids by name. */
export async function seedDocumentCategories(
  tx: TxClient,
  businessId: string,
  categories: (typeof SEED_DOCUMENT_CATEGORIES)[keyof typeof SEED_DOCUMENT_CATEGORIES],
) {
  const ids = new Map<string, string>();
  for (const [sortOrder, c] of categories.entries()) {
    const data = { sortOrder, retentionYears: c.retentionYears };
    const row = await tx.documentCategory.upsert({
      where: { businessId_name: { businessId, name: c.name } },
      update: data,
      create: { businessId, name: c.name, ...data },
    });
    ids.set(c.name, row.id);
  }
  return byName('document category', ids);
}

/** A published v1 intake form for each named service; returns their ids by service name. */
export async function seedAppointmentTypes(
  tx: TxClient,
  businessId: string,
  types: (typeof SEED_APPOINTMENT_TYPES)[keyof typeof SEED_APPOINTMENT_TYPES],
) {
  const ids = new Map<string, string>();
  for (const [sortOrder, t] of types.entries()) {
    const data = {
      durationMinutes: t.durationMinutes,
      locationKind: t.locationKind,
      clientBookable: t.clientBookable,
      sortOrder,
    };
    const row = await tx.appointmentType.upsert({
      where: { businessId_name: { businessId, name: t.name } },
      update: data,
      create: { businessId, name: t.name, ...data },
    });
    ids.set(t.name, row.id);
  }
  return byName('appointment type', ids);
}

export function byName(kind: string, ids: Map<string, string>) {
  return (name: string) => {
    const id = ids.get(name);
    if (!id) throw new Error(`Seed ${kind} ${name} is missing`);
    return id;
  };
}

/** A published v1 intake form per service (the real Annual Tax form; a small stand-in for the rest). */
export async function seedIntakeForms(
  tx: TxClient,
  businessId: string,
  service: (name: string) => string,
  serviceNames: readonly string[],
) {
  const ids = new Map<string, string>();
  for (const name of serviceNames) {
    const serviceId = service(name);
    const { kind } = await tx.service.findUniqueOrThrow({ where: { id: serviceId } });
    // The database files a new form under the service's default template (R37).
    const found = await tx.intakeForm.findFirst({ where: { businessId, serviceId, version: 1 } });
    const row =
      found ??
      (await tx.intakeForm.create({
        data: {
          businessId,
          serviceId,
          version: 1,
          title: `${name} intake`,
          // Annual Tax is the real form (R11's contract); the other kinds keep a small stand-in, so
          // the seeded lead's answers and upload slot fit their form (real forms: r0_followups).
          definition:
            kind === 'ANNUAL_TAX' && INTAKE_FORMS.ANNUAL_TAX
              ? INTAKE_FORMS.ANNUAL_TAX
              : seedFormDefinition(kind, `${name} intake`),
          // Deprecated: the agreement comes from the firm's intake agreements (seedFirmAgreement).
          agreementText: null,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      }));
    ids.set(name, row.id);
  }
  return byName('intake form', ids);
}

/** The firm-wide intake agreement with a synthetic v1 and a CLEAN PDF row (no file in S3). */
export async function seedFirmAgreement(
  tx: TxClient,
  businessId: string,
  ownerId: string,
  ids: { agreement: string; file: string; version: string },
) {
  await tx.firmAgreement.upsert({
    where: { id: ids.agreement },
    update: {},
    create: { id: ids.agreement, businessId, scope: 'ALL_INTAKES', createdByUserId: ownerId },
  });
  const sha256 = createHash('sha256').update(`sample agreement pdf ${businessId}`).digest('hex');
  await tx.firmAgreementFile.upsert({
    where: { id: ids.file },
    update: {},
    create: {
      id: ids.file,
      businessId,
      fileName: SAMPLE_AGREEMENT.pdf.fileName,
      sizeBytes: SAMPLE_AGREEMENT.pdf.sizeBytes,
      sha256,
      s3Key: `tenant/${businessId}/agreements/${ids.file}`,
      uploadedByUserId: ownerId,
    },
  });
  await tx.firmAgreementFile.updateMany({
    where: { id: ids.file, scanStatus: 'PENDING' },
    data: { scanStatus: 'CLEAN', scannedAt: new Date() },
  });
  // Versions are insert-only (an upsert may update), so create it once.
  if (!(await tx.firmAgreementVersion.findUnique({ where: { id: ids.version } }))) {
    await tx.firmAgreementVersion.create({
      data: {
        id: ids.version,
        businessId,
        agreementId: ids.agreement,
        version: 1,
        title: SAMPLE_AGREEMENT.title,
        bodyMarkdown: SAMPLE_AGREEMENT.body,
        acknowledgments: SAMPLE_AGREEMENT.acknowledgments.map((a) => ({ ...a })),
        pdfFileId: ids.file,
        pdfSha256: sha256,
        publishedByUserId: ownerId,
      },
    });
  }
}
