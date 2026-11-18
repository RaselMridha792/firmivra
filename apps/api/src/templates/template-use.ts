import type { TxClient } from '@firmivra/db';
import type { TemplateUsePurpose } from '@firmivra/types';

/**
 * Templates Review Two Y04/Y09: one use of a template, written when what it gave actually goes
 * out (a campaign starts, a message is sent, an automation sends it): which version, for what,
 * by whom and when. The log is append-only (the database refuses an update or a delete), and the
 * sent content itself stays on the message, so a later edit, archive or restore never rewrites
 * it. `version` is the one the content was copied from when it is known (Communications keeps
 * it); otherwise the template's version at the time of sending.
 */
export async function recordTemplateUse(
  tx: TxClient,
  use: {
    businessId: string;
    templateId: string;
    version?: number | null;
    purpose: TemplateUsePurpose;
    entityType: string;
    entityId: string;
    usedByUserId: string | null;
  },
): Promise<void> {
  const version =
    use.version ??
    (
      await tx.messageTemplate.findFirst({
        where: { businessId: use.businessId, id: use.templateId },
        select: { version: true },
      })
    )?.version;
  if (version === undefined) return;
  await tx.messageTemplateUse.create({
    data: {
      businessId: use.businessId,
      templateId: use.templateId,
      version,
      purpose: use.purpose,
      entityType: use.entityType,
      entityId: use.entityId,
      usedByUserId: use.usedByUserId,
    },
  });
}
