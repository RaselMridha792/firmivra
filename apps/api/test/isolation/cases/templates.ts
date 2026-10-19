// Message templates (R55): the library, versions, sharing, attachments, preview, bulk actions,
// import, categories and custom merge fields. Each route that changes a record gets a record of
// its own, so one case never breaks the next (an archived template takes no edit, a merged
// category cannot be merged again).
import { randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef, SeedContext } from '../world.js';

const BASE = '/api/v1/business';
const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a PATCH case can send the version (etag) without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const ETAG = STAMP.toISOString();

/** A template of the world's firm, owned by the firm's Owner. */
const template = (extra: Record<string, unknown> = {}): RecordDef => ({
  async create({ tx, businessId, owner }) {
    const row = await tx.messageTemplate.create({
      data: {
        businessId,
        kind: 'EMAIL',
        name: `Fake template ${tag()}`,
        subject: 'Fake subject',
        body: '<p>Fake body for [Client First Name]</p>',
        ownerUserId: owner.id,
        createdAt: STAMP,
        updatedAt: STAMP,
        ...extra,
      },
    });
    await tx.messageTemplateVersion.create({
      data: {
        businessId,
        templateId: row.id,
        version: 1,
        name: row.name,
        subject: row.subject,
        body: row.body,
        savedByUserId: owner.id,
      },
    });
    return row.id;
  },
});

const category = (extra: Record<string, unknown> = {}): RecordDef => ({
  async create({ tx, businessId }) {
    const row = await tx.templateCategory.create({
      data: { businessId, kind: 'EMAIL', name: `Fake category ${tag()}`, ...extra },
    });
    return row.id;
  },
});

const attachment =
  (templateKey: string): RecordDef['create'] =>
  async ({ tx, businessId, get }: SeedContext) => {
    const row = await tx.messageTemplateAttachment.create({
      data: {
        businessId,
        templateId: await get(templateKey),
        fileName: 'fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        s3Key: `tenant/${businessId}/templates/${randomUUID()}`,
      },
    });
    return row.id;
  };

const field = (): RecordDef => ({
  async create({ tx, businessId }) {
    const row = await tx.customMergeField.create({
      data: {
        businessId,
        key: `Fake Field ${tag().replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)] ?? 'g')}`,
        label: 'Fake field',
      },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  tpl: template(),
  tplPatch: template(),
  tplArchive: template(),
  tplRestore: template({ status: 'ARCHIVED', archivedAt: STAMP }),
  tplShares: template(),
  tplVersions: template(),
  tplAttach: template(),
  tplBulk: template(),
  tplWithAttachment: template(),
  tplAttachment: { create: attachment('tplWithAttachment') },
  tplWithAttachmentDelete: template(),
  tplAttachmentDelete: { create: attachment('tplWithAttachmentDelete') },
  templateCategory: category(),
  templateCategoryEdit: category(),
  templateCategoryMerge: category(),
  templateCategoryInto: category(),
  templateCategoryArchive: category(),
  templateCategoryRestore: category({ archivedAt: STAMP }),
  templateCategoryOrder: category(),
  templateField: field(),
  templateFieldDelete: field(),
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}/templates`]: {
    params: {},
    bodyIds: { categoryId: 'templateCategory', sharedWithUserIds: 'adminUser' },
    body: () => ({
      kind: 'EMAIL',
      name: `Fake new template ${tag()}`,
      body: '<p>Fake body</p>',
      access: 'SELECTED',
    }),
  },
  [`GET ${BASE}/templates/:id`]: { params: { id: 'tpl' } },
  [`PATCH ${BASE}/templates/:id`]: {
    params: { id: 'tplPatch' },
    bodyIds: { categoryId: 'templateCategory', sharedWithUserIds: 'adminUser' },
    body: { etag: ETAG, access: 'SELECTED', description: 'Fake description' },
  },
  [`POST ${BASE}/templates/:id/duplicate`]: { params: { id: 'tpl' } },
  [`POST ${BASE}/templates/:id/archive`]: { params: { id: 'tplArchive' } },
  [`POST ${BASE}/templates/:id/restore`]: { params: { id: 'tplRestore' } },
  [`PUT ${BASE}/templates/:id/favorite`]: { params: { id: 'tpl' } },
  [`DELETE ${BASE}/templates/:id/favorite`]: { params: { id: 'tpl' } },
  [`PUT ${BASE}/templates/:id/shares`]: {
    params: { id: 'tplShares' },
    bodyIds: { userIds: 'adminUser' },
  },
  [`GET ${BASE}/templates/:id/versions`]: { params: { id: 'tplVersions' } },
  [`GET ${BASE}/templates/:id/versions/:version`]: {
    params: { id: 'tplVersions' },
  },
  [`POST ${BASE}/templates/:id/versions/:version/restore`]: {
    params: { id: 'tplVersions' },
  },
  [`POST ${BASE}/templates/:id/preview`]: {
    params: { id: 'tpl' },
    bodyIds: {
      clientId: 'client',
      appointmentId: 'appointment',
      invoiceId: 'invoice',
      taskId: 'task',
    },
    body: {},
  },
  // The sending needs a Templates message in the notify service, which is not there yet: 503.
  [`POST ${BASE}/templates/:id/test-send`]: {
    params: { id: 'tpl' },
    body: { channel: 'EMAIL' },
    expect: 503,
  },
  [`POST ${BASE}/templates/:id/attachments/uploads`]: {
    params: { id: 'tplAttach' },
    body: {
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
  },
  // No file store in tests: the download's check of the stored file answers 503.
  [`GET ${BASE}/templates/:id/attachments/:attachmentId/download`]: {
    params: { id: 'tplWithAttachment', attachmentId: 'tplAttachment' },
    expect: 503,
  },
  [`DELETE ${BASE}/templates/:id/attachments/:attachmentId`]: {
    params: { id: 'tplWithAttachmentDelete', attachmentId: 'tplAttachmentDelete' },
  },
  [`POST ${BASE}/templates/bulk`]: {
    params: {},
    bodyIds: { ids: 'tplBulk', categoryId: 'templateCategory' },
    body: { action: 'SET_CATEGORY' },
  },
  [`POST ${BASE}/templates/import`]: {
    params: {},
    bodyIds: { categoryId: 'templateCategory' },
    body: () => ({
      kind: 'EMAIL',
      name: `Fake imported template ${tag()}`,
      format: 'TEXT',
      content: 'Fake content',
    }),
  },
  [`PUT ${BASE}/template-categories/order`]: {
    params: {},
    bodyIds: { ids: 'templateCategoryOrder' },
    body: { kind: 'EMAIL' },
  },
  [`PUT ${BASE}/template-categories/:id`]: {
    params: { id: 'templateCategoryEdit' },
    body: () => ({ name: `Fake renamed category ${tag()}` }),
  },
  [`POST ${BASE}/template-categories/:id/merge`]: {
    params: { id: 'templateCategoryMerge' },
    bodyIds: { intoId: 'templateCategoryInto' },
  },
  [`POST ${BASE}/template-categories/:id/archive`]: { params: { id: 'templateCategoryArchive' } },
  [`POST ${BASE}/template-categories/:id/restore`]: { params: { id: 'templateCategoryRestore' } },
  [`PUT ${BASE}/template-merge-fields/:id`]: {
    params: { id: 'templateField' },
    body: () => ({ key: `Fake Renamed ${tag().replace(/[0-9]/g, 'x')}`, label: 'Fake renamed' }),
  },
  [`DELETE ${BASE}/template-merge-fields/:id`]: { params: { id: 'templateFieldDelete' } },
};
