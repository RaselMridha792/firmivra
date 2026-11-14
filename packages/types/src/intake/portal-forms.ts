import { z } from 'zod';
import { IntakeFormKey } from './definition.js';

// Intake Forms Review Two, INTAKE-ACCESS-02 part B (decisions 1a and 3, Nov 15): a form the firm
// publishes in the client portal is listed for every client of the firm, whatever their services,
// and a client starts it on their own: a PENDING service (as Begin Online makes, for the firm to
// review) and the form on it, which they fill as any form the firm sent. A signed-in client who
// opens the form's share link starts it the same way, even when it is not published in the portal.

/** One form published in the client portal (`api.myIntakes(slug).forms()`). */
export const PortalIntakeForm = z.object({
  templateId: z.uuid(),
  title: z.string(),
  form: IntakeFormKey,
  serviceName: z.string(),
  /** The client's open form of it (sent, in progress or sent back), to continue; else null. */
  intakeId: z.uuid().nullable(),
});
export type PortalIntakeForm = z.infer<typeof PortalIntakeForm>;

export const PortalIntakeFormList = z.object({ items: z.array(PortalIntakeForm).max(100) });
