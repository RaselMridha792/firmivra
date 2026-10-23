// The Intake Forms workspace (R55): the library and builder (a form by id), the firm's settings,
// sending a form and its drafts, and one assigned form's record and More menu.
import { randomUUID } from 'node:crypto';
import { INTAKE_FORMS } from '@firmivra/types';
import type { CaseModule } from '../world.js';

const STAMP = new Date('2026-01-01T00:00:00.000Z');
const PLACEHOLDER = randomUUID();

export const records: CaseModule['records'] = {
  /** An Admin of the firm; the firm's intake settings are saved at a fixed time so a change can send the version. */
  intakeSettingsAdmin: {
    async create({ tx, businessId, get }) {
      await tx.intakeSettings.upsert({
        where: { businessId },
        create: { businessId, updatedAt: STAMP },
        update: { updatedAt: STAMP },
      });
      return get('adminUser');
    },
  },
  /** The library entry (template) of the world's published form. */
  intakeTemplate: {
    async create({ tx, businessId, get }) {
      const form = await tx.intakeForm.findFirstOrThrow({
        where: { businessId, id: await get('intakeForm') },
        select: { templateId: true },
      });
      return form.templateId as string;
    },
  },
  /**
   * A form the firm made in the builder, with a draft version: the builder's writes (save,
   * publish, archive) act on it, never on the service's default form other cases send.
   */
  builderTemplate: {
    async create({ tx, businessId, owner, own }) {
      const template = await tx.intakeTemplate.create({
        data: { businessId, serviceId: own.service, createdByUserId: owner.id },
      });
      await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: own.service,
          templateId: template.id,
          version: 1,
          title: 'Fake builder form',
          definition: INTAKE_FORMS.ANNUAL_TAX as object,
          createdByUserId: owner.id,
        },
      });
      return template.id;
    },
  },
  /** The Owner's unsent send draft of the world's form to client X (a DRAFT intake). */
  sendDraft: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const row = await tx.intake.create({
        data: {
          businessId,
          formId: await get('intakeForm'),
          engagementId: await get('engagement'),
          status: 'DRAFT',
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

const sendIds = {
  'recipient.id': 'client',
  formId: 'intakeTemplate',
  engagementId: 'engagement',
  assignedUserId: 'adminUser',
};
const sendFields = {
  recipient: { kind: 'CLIENT', id: PLACEHOLDER },
  formId: PLACEHOLDER,
  engagementId: PLACEHOLDER,
  assignedUserId: PLACEHOLDER,
  channel: 'PORTAL',
  subject: 'Fake subject',
  message: 'Fake message',
};

export const cases: CaseModule['cases'] = {
  'PUT /api/v1/business/intake-settings': {
    params: {},
    bodyIds: {
      'general.defaultOwnerUserId': 'intakeSettingsAdmin',
      'automation.defaultFollowUpOwnerUserId': 'intakeSettingsAdmin',
    },
    body: {
      version: STAMP.toISOString(),
      general: { defaultOwnerUserId: PLACEHOLDER },
      automation: { defaultFollowUpOwnerUserId: PLACEHOLDER },
    },
  },
  'GET /api/v1/business/intake-forms/:id': { params: { id: 'intakeTemplate' } },
  // A main form's public link (I3): firm B's id is 404 like any other form's.
  'GET /api/v1/business/intake-forms/:id/public-link': { params: { id: 'intakeTemplate' } },

  // The builder.
  'POST /api/v1/business/intake-forms': {
    params: {},
    bodyIds: { serviceId: 'service', 'startFrom.formId': 'intakeTemplate' },
    body: {
      name: 'Fake new form',
      category: 'PERSONAL_TAX',
      serviceId: PLACEHOLDER,
      startFrom: { kind: 'TEMPLATE', formId: PLACEHOLDER },
    },
  },
  'PUT /api/v1/business/intake-forms/:id': {
    params: { id: 'builderTemplate' },
    bodyIds: { serviceId: 'service' },
    body: { name: 'Fake saved form', category: 'PERSONAL_TAX', serviceId: PLACEHOLDER },
  },
  'POST /api/v1/business/intake-forms/:id/publish': { params: { id: 'builderTemplate' } },
  'POST /api/v1/business/intake-forms/:id/duplicate': {
    params: { id: 'builderTemplate' },
    body: {},
  },
  'POST /api/v1/business/intake-forms/:id/archive': { params: { id: 'builderTemplate' } },

  // Send Intake Form and its drafts.
  'POST /api/v1/business/intakes/send': {
    params: {},
    bodyIds: sendIds,
    body: () => ({ ...sendFields, idempotencyKey: randomUUID() }),
  },
  'POST /api/v1/business/intakes/send-drafts': {
    params: {},
    bodyIds: sendIds,
    body: sendFields,
  },
  'PUT /api/v1/business/intakes/send-drafts/:draftId': {
    params: { draftId: 'sendDraft' },
    bodyIds: sendIds,
    body: sendFields,
  },

  // One assigned form.
  'GET /api/v1/business/intakes/:id/record': { params: { id: 'intake' } },
  // No table keeps notes yet: refused after the form is found.
  'POST /api/v1/business/intakes/:id/notes': {
    params: { id: 'intake' },
    body: { text: 'Fake note' },
    expect: 503,
  },
  'PATCH /api/v1/business/intakes/:id': {
    params: { id: 'intake' },
    bodyIds: { assignedUserId: 'adminUser' },
    body: { assignedUserId: PLACEHOLDER },
  },
  'POST /api/v1/business/intakes/:id/resend': { params: { id: 'intake' } },
  'POST /api/v1/business/intakes/:id/remind': { params: { id: 'intake' } },
  'POST /api/v1/business/intakes/:id/archive': { params: { id: 'intake' } },
  // No file store in tests: the PDF cannot be saved, so it is refused after the form is found.
  'GET /api/v1/business/intakes/:id/pdf': { params: { id: 'intake' }, expect: 503 },
};
