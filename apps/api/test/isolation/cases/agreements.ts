// The firm's intake agreements (R14): Settings > Terms & Privacy. Firm-wide records, so no
// client's portal walls them off; Begin Online reads them publicly by slug and form, and the
// portal intake reads them for one of the client's own intakes.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule, SeedContext } from '../world.js';

/** A PDF original, scanned CLEAN (a new file starts PENDING; the scan result is set once). */
async function cleanFile({ tx, businessId, owner }: SeedContext): Promise<string> {
  const id = randomUUID();
  await tx.firmAgreementFile.create({
    data: {
      id,
      businessId,
      fileName: 'fake-agreement.pdf',
      sizeBytes: 1024,
      sha256: createHash('sha256').update(id).digest('hex'),
      s3Key: `tenant/${businessId}/agreements/${id}.pdf`,
      uploadedByUserId: owner.id,
    },
  });
  await tx.firmAgreementFile.update({ where: { id }, data: { scanStatus: 'CLEAN' } });
  return id;
}

export const records: CaseModule['records'] = {
  /** A clean PDF no version links yet, for a publish. */
  agreementFile: { create: cleanFile },
  /**
   * A service agreement of firm P with version 1 (the path's fixed :version). A service one, so
   * every world can have its own (one firm-wide agreement per firm) and archive can answer 2xx.
   */
  agreement: {
    async create(ctx) {
      const { tx, businessId, owner, own } = ctx;
      const agreement = await tx.firmAgreement.create({
        data: { businessId, scope: 'SERVICE', serviceId: own.service, createdByUserId: owner.id },
      });
      const pdfFileId = await cleanFile(ctx);
      const pdf = await tx.firmAgreementFile.findUniqueOrThrow({ where: { id: pdfFileId } });
      await tx.firmAgreementVersion.create({
        data: {
          businessId,
          agreementId: agreement.id,
          version: 1,
          title: 'Fake agreement',
          bodyMarkdown: 'Fake agreement text',
          pdfFileId,
          pdfSha256: pdf.sha256,
          publishedByUserId: owner.id,
        },
      });
      return agreement.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/agreements': {
    params: {},
    body: { scope: 'SERVICE' },
    bodyIds: { serviceId: 'service' },
  },
  'GET /api/v1/business/agreements/files/:fileId': { params: { fileId: 'agreementFile' } },
  // No file store in tests: found, then 503.
  'GET /api/v1/business/agreements/files/:fileId/download': {
    params: { fileId: 'agreementFile' },
    expect: 503,
  },
  'GET /api/v1/business/agreements/:agreementId': { params: { agreementId: 'agreement' } },
  'GET /api/v1/business/agreements/:agreementId/versions/:version': {
    params: { agreementId: 'agreement' },
  },
  'POST /api/v1/business/agreements/:agreementId/versions': {
    params: { agreementId: 'agreement' },
    body: {
      expectedCurrentVersion: 1,
      title: 'Fake agreement v2',
      bodyMarkdown: 'Fake agreement text, version 2',
      acknowledgments: [],
    },
    bodyIds: { pdfFileId: 'agreementFile' },
  },
  'POST /api/v1/business/agreements/:agreementId/archive': {
    params: { agreementId: 'agreement' },
  },
  // Client X's open intake (the `intake` record of intakes.ts).
  'GET /api/v1/portal/:firmSlug/me/intakes/:intakeId/agreements': {
    params: { intakeId: 'intake' },
  },
};

export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/portal/:firmSlug/intake-agreements':
    "Public: the firm's current intake agreements for a Begin Online form, from the slug only",
  'GET /api/v1/portal/:firmSlug/intake-agreements/:agreementId/versions/:version/pdf':
    "Public: the PDF of a firm's current agreement version, from the slug only",
};
