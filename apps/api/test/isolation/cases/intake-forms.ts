// The firm's published intake forms, which portal intakes and Begin Online leads are filled in
// with. The same file in every branch that needs a form, so the record key is defined once.
import { ANNUAL_TAX_FORM } from '@firmivra/types';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A published Annual Tax form of firm P's annual tax service; each world its own version. */
  intakeForm: {
    async create({ tx, businessId, own }) {
      // Each world adds a version: (business, service, version) is unique.
      const top = await tx.intakeForm.aggregate({
        where: { businessId, serviceId: own.service },
        _max: { version: true },
      });
      const row = await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: own.service,
          version: (top._max.version ?? 0) + 1,
          title: ANNUAL_TAX_FORM.title,
          definition: ANNUAL_TAX_FORM,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      return row.id;
    },
  },
};
