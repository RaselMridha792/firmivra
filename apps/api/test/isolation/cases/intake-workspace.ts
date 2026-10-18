// The Intake Forms workspace (R55): a form of the library, by id.
import { randomUUID } from 'node:crypto';
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
};
