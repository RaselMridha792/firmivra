// Firm Sign (R13): requests, templates, bulk sends, approvals, roles and the portal's Signature
// center. Firm Sign is on in firms P and Q (tenant-isolation.test.ts). Each request and template
// record has its PDF in `esignStore`, the suite's file store, so a positive control that reads the
// file answers 2xx. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { MemoryEsignStore } from '../../../src/esign/engine/esign-store.js';
import { pdf } from '../../unit/esign-engine-fixtures.js';
import type { CaseModule, SeedContext } from '../world.js';

/** The suite's Firm Sign file store (tenant-isolation.test.ts overrides ESIGN_STORE with it). */
export const esignStore = new MemoryEsignStore();

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PAGE = { width: 612, height: 792 };
let bytes: Promise<Uint8Array> | undefined;
/** A two-page PDF, made once. */
const twoPages = () =>
  (bytes ??= pdf([
    [PAGE.width, PAGE.height],
    [PAGE.width, PAGE.height],
  ]));
const SETTINGS = {
  routing: 'SEQUENTIAL' as const,
  expiryDays: 30,
  reminderFirstAfterDays: 3,
  reminderEveryDays: 3,
  reminderMax: 3,
  expiryWarningDays: 2,
};
const BOX = { x: 0.1, y: 0.1, w: 0.3, h: 0.05 };

/** Client X's portal login. */
async function loginOf({ tx, get }: SeedContext): Promise<{ id: string; email: string }> {
  const clientId = await get('client');
  const login = await tx.clientAccount.findFirstOrThrow({
    where: { clientId },
    select: { id: true, email: true },
  });
  return { id: login.id, email: login.email! };
}

/** A staff member of the world's firm (`role`), with an active membership. */
async function member(ctx: SeedContext, label: string, role: 'STAFF' | 'ADMIN') {
  const login = await ctx.person(label, 'STAFF');
  await ctx.tx.membership.create({
    data: { businessId: ctx.businessId, userId: login.id, role, status: 'ACTIVE' },
  });
  return login;
}

type Shape = {
  /** Who sends it (the world's Owner when left out). */
  senderUserId?: string;
  /** An approver (a staff member's id) and their status. */
  approver?: { userId: string; email: string; status: 'WAITING' | 'SENT' };
};

/**
 * A DRAFT for client X and their engagement: one CLEAN uploaded PDF (in `esignStore`), its two
 * pages, client X's login as the signer (LINK) with a SIGNATURE on page 2. Records its parts
 * under `<prefix>Document`, `<prefix>Recipient` and `<prefix>Field`.
 */
async function draft(ctx: SeedContext, prefix: string, shape: Shape = {}) {
  const { tx, businessId, owner, set } = ctx;
  const file = await twoPages();
  const login = await loginOf(ctx);
  const id = randomUUID();
  const documentId = randomUUID();
  // The firm's consent text (version 1, once per firm): a request is sent only with one.
  const consent = 'Fake consent to sign electronically.';
  await tx.esignConsentVersion.createMany({
    data: [{ businessId, version: 1, bodyMarkdown: consent, sha256: sha256(Buffer.from(consent)) }],
    skipDuplicates: true,
  });
  await tx.esignRequest.create({
    data: {
      ...{ id, businessId, title: `Fake ${prefix}`, source: 'TAB', ...SETTINGS },
      ...{ clientId: await ctx.get('client'), engagementId: await ctx.get('engagement') },
      senderUserId: shape.senderUserId ?? owner.id,
      pagePlan: [0, 1].map((page) => ({ documentId, page, rotation: 0 })),
    },
  });
  const key = esignStore.keyFor(businessId, id, `documents/${documentId}.pdf`);
  esignStore.objects.set(key, { bytes: file, contentType: 'application/pdf' });
  await tx.esignDocument.create({
    data: {
      ...{ id: documentId, businessId, requestId: id, position: 0, fileName: 'fake-form.pdf' },
      ...{ contentType: 'application/pdf', sizeBytes: file.byteLength, sha256: sha256(file) },
      ...{ pageCount: 2, pageSizes: [PAGE, PAGE], s3Key: key },
      ...{ scanStatus: 'CLEAN', scannedAt: new Date() },
    },
  });
  const signer = await tx.esignRecipient.create({
    data: {
      ...{ businessId, requestId: id, position: 0, kind: 'SIGNER', role: 'CLIENT' },
      ...{ routingOrder: 1, name: 'Fake Client X', email: login.email },
      ...{ linkType: 'CLIENT_LOGIN', clientAccountId: login.id, delivery: 'EMAIL' },
      ...{ authMethod: 'LINK', colorIndex: 0 },
    },
  });
  if (shape.approver) {
    const a = shape.approver;
    await tx.esignRecipient.create({
      data: {
        ...{ businessId, requestId: id, position: 1, kind: 'APPROVER', role: 'MANAGER' },
        ...{ routingOrder: 1, name: 'Fake approver', email: a.email },
        ...{ linkType: 'STAFF', staffUserId: a.userId, delivery: 'EMAIL' },
        ...{ authMethod: 'EMAIL_CODE', colorIndex: 1, status: a.status },
        ...(a.status === 'SENT' && { sentAt: new Date() }),
      },
    });
  }
  const field = await tx.esignField.create({
    data: {
      ...{ businessId, requestId: id, recipientId: signer.id, position: 0 },
      ...{ type: 'SIGNATURE', pageIndex: 1, ...BOX, required: true },
    },
  });
  set(`${prefix}Document`, documentId);
  set(`${prefix}Recipient`, signer.id);
  set(`${prefix}Field`, field.id);
  return { id, signer: signer.id, file };
}

/** A part a record's create() sets (`staffMembership`'s pattern in team.ts). */
const partOf = (owner: string, key: string, clientPrivate = false) => ({
  clientPrivate,
  async create({ get }: SeedContext) {
    await get(owner);
    return get(key);
  },
});

export const records: CaseModule['records'] = {
  /** Client X's portal login (a request's signer). */
  esignLogin: { clientPrivate: true, create: async (ctx) => (await loginOf(ctx)).id },
  /** A DRAFT the Owner sends: ready to send. */
  esignDraft: { create: async (ctx) => (await draft(ctx, 'esignDraft')).id },
  esignDraftDocument: partOf('esignDraft', 'esignDraftDocument'),
  esignDraftRecipient: partOf('esignDraft', 'esignDraftRecipient'),
  esignDraftField: partOf('esignDraft', 'esignDraftField'),
  /** The same, SENT: client X's turn (their Signature center lists it). */
  esignSent: {
    clientPrivate: true,
    async create(ctx) {
      const { tx, businessId } = ctx;
      const d = await draft(ctx, 'esignSent');
      // An EXTERNAL signer after client X (only an EXTERNAL one's name and email are corrected).
      const external = await tx.esignRecipient.create({
        data: {
          ...{ businessId, requestId: d.id, position: 1, kind: 'SIGNER', role: 'WITNESS' },
          ...{ routingOrder: 2, name: 'Fake Witness', email: 'fake-witness@iso.test' },
          ...{ linkType: 'EXTERNAL', delivery: 'EMAIL', authMethod: 'EMAIL_CODE', colorIndex: 1 },
        },
      });
      ctx.set('esignSentExternal', external.id);
      const originalSha256 = sha256(d.file);
      const packet = esignStore.keyFor(businessId, d.id, `packet-${originalSha256}.pdf`);
      esignStore.objects.set(packet, { bytes: d.file, contentType: 'application/pdf' });
      const sentAt = new Date();
      await tx.esignRecipient.update({
        where: { id: d.signer },
        data: { status: 'SENT', sentAt },
      });
      await tx.esignRequest.update({
        where: { id: d.id },
        data: {
          ...{ status: 'SENT', sentAt, originalSha256 },
          expiresAt: new Date(+sentAt + SETTINGS.expiryDays * 86_400_000),
        },
      });
      return d.id;
    },
  },
  esignSentRecipient: partOf('esignSent', 'esignSentRecipient', true),
  esignSentExternal: partOf('esignSent', 'esignSentExternal'),
  /** A DRAFT a Staff member made with the Owner as its approver, not yet submitted. */
  esignToApprove: {
    async create(ctx) {
      const sender = await member(ctx, 'esign-sender', 'STAFF');
      const approver = { userId: ctx.owner.id, email: ctx.owner.email, status: 'WAITING' as const };
      return (await draft(ctx, 'esignToApprove', { senderUserId: sender.id, approver })).id;
    },
  },
  /** The same, submitted: NEEDS_APPROVAL, the Owner's turn to decide. */
  esignApproval: {
    async create(ctx) {
      const sender = await member(ctx, 'esign-sender', 'STAFF');
      const approver = { userId: ctx.owner.id, email: ctx.owner.email, status: 'SENT' as const };
      const d = await draft(ctx, 'esignApproval', { senderUserId: sender.id, approver });
      await ctx.tx.esignRequest.update({
        where: { id: d.id },
        data: { status: 'NEEDS_APPROVAL' },
      });
      return d.id;
    },
  },
  /** An Admin: an approver the Owner may name. */
  esignApprover: { create: async (ctx) => (await member(ctx, 'esign-approver', 'ADMIN')).id },
  /** A CLEAN PDF in client X's vault (from-vault copies it). */
  esignVaultDocument: {
    clientPrivate: true,
    async create(ctx) {
      const { tx, businessId } = ctx;
      const file = await twoPages();
      const id = randomUUID();
      const s3Key = `tenant/${businessId}/documents/${id}.pdf`;
      esignStore.objects.set(s3Key, { bytes: file, contentType: 'application/pdf' });
      await tx.document.create({
        data: {
          ...{ id, businessId, clientId: await ctx.get('client'), direction: 'FIRM_TO_CLIENT' },
          ...{ engagementId: await ctx.get('engagement'), s3Key },
          ...{ fileName: 'fake-letter.pdf', contentType: 'application/pdf' },
          ...{ sizeBytes: file.byteLength, sha256: sha256(file) },
        },
      });
      await tx.document.update({
        where: { id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      return id;
    },
  },
  /**
   * A firm-wide template at version 1 (its PDF in `esignStore`): a CLIENT role and a PREPARER
   * role, each with a SIGNATURE.
   */
  esignTemplate: {
    async create({ tx, businessId, owner }) {
      const file = await twoPages();
      const template = await tx.esignTemplate.create({
        data: {
          ...{ businessId, name: `Fake template ${randomUUID().slice(0, 8)}` },
          ...{ visibility: 'FIRM', ownerUserId: owner.id },
        },
      });
      const s3Key = esignStore.keyFor(businessId, template.id, `template-${sha256(file)}.pdf`);
      esignStore.objects.set(s3Key, { bytes: file, contentType: 'application/pdf' });
      const role = (key: string, r: 'CLIENT' | 'PREPARER', i: number) => ({
        ...{ key, kind: 'SIGNER', role: r, roleLabel: null, routingOrder: i + 1 },
        ...{ authMethod: 'EMAIL_CODE', colorIndex: i },
      });
      const field = (roleKey: string) => ({
        ...{ id: randomUUID(), roleKey, type: 'SIGNATURE', pageIndex: 1, ...BOX },
        ...{ required: true, label: null, mergeKey: null, options: [], groupKey: null },
        value: null,
      });
      await tx.esignTemplateVersion.create({
        data: {
          ...{ businessId, templateId: template.id, version: 1, savedByUserId: owner.id },
          ...{ s3Key, sha256: sha256(file), sizeBytes: file.byteLength, pageSizes: [PAGE, PAGE] },
          roles: [role('client', 'CLIENT', 0), role('preparer', 'PREPARER', 1)],
          fields: [field('client'), field('preparer')],
          ...SETTINGS,
        },
      });
      return template.id;
    },
  },
  /** A bulk send of the template to client X, its row still QUEUED. */
  esignBatch: {
    async create(ctx) {
      const { tx, businessId, owner, get } = ctx;
      const templateId = await get('esignTemplate');
      const t = await tx.esignTemplate.findUniqueOrThrow({ where: { id: templateId } });
      const batch = await tx.esignBulkBatch.create({
        data: {
          ...{ businessId, templateId, templateVersion: 1, templateName: t.name },
          ...{ createdByUserId: owner.id, roles: [] },
        },
      });
      await tx.esignBulkItem.create({
        data: {
          ...{ businessId, batchId: batch.id, position: 0, requestId: randomUUID() },
          ...{ clientId: await get('client'), engagementId: await get('engagement') },
        },
      });
      return batch.id;
    },
  },
};

const name = () => ({ name: `Fake copy ${randomUUID().slice(0, 8)}` });
/** A recipient list naming client X's login and an approver (the two kinds of `who`). */
const RECIPIENTS = {
  recipients: [
    {
      id: '',
      role: 'CLIENT',
      routingOrder: 1,
      who: { type: 'CLIENT_LOGIN', clientAccountId: '' },
      authMethod: 'LINK',
    },
    { kind: 'APPROVER', role: 'MANAGER', routingOrder: 1, who: { type: 'STAFF', userId: '' } },
  ],
};

export const cases: CaseModule['cases'] = {
  // ---------- Requests and their drafts ----------
  'POST /api/v1/esign/requests': {
    params: {},
    body: { title: 'Fake request' },
    bodyIds: { clientId: 'client', engagementId: 'engagement' },
  },
  'GET /api/v1/esign/requests/:id': { params: { id: 'esignDraft' } },
  'PATCH /api/v1/esign/requests/:id': {
    params: { id: 'esignDraft' },
    body: { title: 'Fake new title' },
    bodyIds: { clientId: 'client', engagementId: 'engagement' },
  },
  'DELETE /api/v1/esign/requests/:id': { params: { id: 'esignDraft' } },
  'PUT /api/v1/esign/requests/:id/page-plan': {
    params: { id: 'esignDraft' },
    body: { pages: [{ documentId: '', page: 0, rotation: 0 }] },
    bodyIds: { 'pages.documentId': 'esignDraftDocument' },
  },
  'PUT /api/v1/esign/requests/:id/recipients': {
    params: { id: 'esignDraft' },
    body: RECIPIENTS,
    bodyIds: {
      'recipients.id': 'esignDraftRecipient',
      'recipients.who.clientAccountId': 'esignLogin',
      'recipients.who.userId': 'esignApprover',
    },
  },
  'PUT /api/v1/esign/requests/:id/fields': {
    params: { id: 'esignDraft' },
    body: { fields: [{ id: '', recipientId: '', type: 'SIGNATURE', pageIndex: 1, ...BOX }] },
    bodyIds: { 'fields.id': 'esignDraftField', 'fields.recipientId': 'esignDraftRecipient' },
  },
  'GET /api/v1/esign/requests/:id/merge-values': { params: { id: 'esignDraft' } },
  'GET /api/v1/esign/requests/:id/readiness': { params: { id: 'esignDraft' } },
  'GET /api/v1/esign/requests/:id/events': { params: { id: 'esignDraft' } },
  'POST /api/v1/esign/requests/:id/send': { params: { id: 'esignDraft' }, body: { confirm: true } },
  'POST /api/v1/esign/requests/:id/documents/uploads': {
    params: { id: 'esignDraft' },
    body: {
      ...{ fileName: 'fake.pdf', contentType: 'application/pdf', sizeBytes: 1024 },
      sha256: 'a'.repeat(64),
    },
  },
  // Found; a made-up upload token is gone (410).
  'POST /api/v1/esign/requests/:id/documents/uploads/confirm': {
    params: { id: 'esignDraft' },
    body: { uploadToken: 'fake-upload-token' },
    expect: 410,
  },
  'POST /api/v1/esign/requests/:id/documents/from-vault': {
    params: { id: 'esignDraft' },
    bodyIds: { documentId: 'esignVaultDocument' },
  },
  'DELETE /api/v1/esign/requests/:id/documents/:documentId': {
    params: { id: 'esignDraft', documentId: 'esignDraftDocument' },
  },
  'GET /api/v1/esign/requests/:id/documents/:documentId/content': {
    params: { id: 'esignDraft', documentId: 'esignDraftDocument' },
  },

  // ---------- After sending ----------
  'POST /api/v1/esign/requests/:id/remind': {
    params: { id: 'esignSent' },
    bodyIds: { recipientId: 'esignSentRecipient' },
  },
  'POST /api/v1/esign/requests/:id/void': {
    params: { id: 'esignSent' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/esign/requests/:id/recipients/:recipientId/correct': {
    params: { id: 'esignSent', recipientId: 'esignSentExternal' },
    body: { name: 'Fake Corrected Name' },
  },
  'POST /api/v1/esign/requests/:id/replace': {
    params: { id: 'esignSent' },
    body: { reason: 'Fake reason' },
  },
  // Found; the signer is not an in-person one (409), so no kiosk locks the Owner's session.
  'POST /api/v1/esign/requests/:id/in-person': {
    params: { id: 'esignSent' },
    bodyIds: { recipientId: 'esignSentRecipient' },
    expect: 409,
  },

  // ---------- Approvals and roles ----------
  'POST /api/v1/esign/requests/:id/submit-for-approval': {
    params: { id: 'esignToApprove' },
    body: { confirm: true },
  },
  'POST /api/v1/esign/requests/:id/approval': {
    params: { id: 'esignApproval' },
    body: { decision: 'REJECT', note: 'Fake change' },
  },
  'PUT /api/v1/esign/roles/:userId': {
    params: { userId: 'staffUser' },
    body: { esignRole: 'MANAGER' },
  },

  // ---------- Templates and bulk send ----------
  'GET /api/v1/esign/templates/:templateId': { params: { templateId: 'esignTemplate' } },
  'PATCH /api/v1/esign/templates/:templateId': {
    params: { templateId: 'esignTemplate' },
    body: { description: 'Fake description' },
  },
  'POST /api/v1/esign/templates/:templateId/archive': { params: { templateId: 'esignTemplate' } },
  'GET /api/v1/esign/templates/:templateId/packet': { params: { templateId: 'esignTemplate' } },
  'POST /api/v1/esign/templates/:templateId/use': {
    params: { templateId: 'esignTemplate' },
    body: {
      roles: [
        { key: 'client', who: { type: 'CLIENT_LOGIN', clientAccountId: '' } },
        { key: 'preparer', who: { type: 'STAFF', userId: '' } },
      ],
    },
    bodyIds: {
      clientId: 'client',
      engagementId: 'engagement',
      'roles.who.clientAccountId': 'esignLogin',
      'roles.who.userId': 'staffUser',
    },
  },
  'POST /api/v1/esign/templates/:templateId/duplicate': {
    params: { templateId: 'esignTemplate' },
    body: name,
  },
  'POST /api/v1/esign/requests/:id/save-as-template': { params: { id: 'esignDraft' }, body: name },
  'POST /api/v1/esign/requests/:id/save-as-version': {
    params: { id: 'esignDraft' },
    bodyIds: { templateId: 'esignTemplate' },
  },
  'GET /api/v1/esign/templates/:templateId/versions': { params: { templateId: 'esignTemplate' } },
  'POST /api/v1/esign/templates/:templateId/versions/:version/restore': {
    params: { templateId: 'esignTemplate' },
  },
  'POST /api/v1/esign/templates/:templateId/bulk-send': {
    params: { templateId: 'esignTemplate' },
    body: {
      clients: [{ clientId: '', engagementId: '' }],
      roles: [{ key: 'preparer', who: { type: 'STAFF', userId: '' } }],
      confirm: true,
    },
    bodyIds: {
      'clients.clientId': 'client',
      'clients.engagementId': 'engagement',
      'roles.who.userId': 'staffUser',
    },
  },
  'GET /api/v1/esign/bulk/:batchId': { params: { batchId: 'esignBatch' } },

  // ---------- The portal's Signature center: client X's own recipient ----------
  'POST /api/v1/portal/:firmSlug/me/signatures/:recipientId/session': {
    params: { recipientId: 'esignSentRecipient' },
  },
  // Found; only a COMPLETED request has files (409).
  'GET /api/v1/portal/:firmSlug/me/signatures/:recipientId/download': {
    params: { recipientId: 'esignSentRecipient' },
    expect: 409,
  },
};

// The signer routes are public: no staff or client session and no record id in the URL. The firm
// comes from the slug and the recipient from the sealed fv_sign_{slug} cookie, bound to that slug
// (other firms' tokens and cookies: test/unit/esign-signer.test.ts).
const SIGNER =
  'Public Firm Sign signer route: firm from the slug, recipient from the sealed slug-bound cookie';

export const excluded: CaseModule['excluded'] = {
  'POST /api/v1/portal/:firmSlug/sign/session': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/state': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/code/send': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/code/verify': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/access-code': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/consent': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/consent': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/session/end': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/envelope': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/packet': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/adopt': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/finish': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/decline': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/attachments/uploads': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/attachments/uploads/confirm': SIGNER,
  // The field is checked against the cookie's recipient (another's: 404, esign-signer-files.test.ts).
  'DELETE /api/v1/portal/:firmSlug/sign/attachments/:fieldId': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/copy': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/copy/download': SIGNER,
};
