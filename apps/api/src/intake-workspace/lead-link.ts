import type { Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { INTAKE_LINK_PATH } from '@firmivra/types';
import { newResumeToken } from '../begin-online/drafts.js';
import type { Env } from '../config/env.js';
import { errorName } from '../notifications/notifier.js';
import type { NotifyService } from '../notify/notify.types.js';

/** How long a lead's link works when the form has no expiration date. */
export const LEAD_LINK_DAYS = 30;

/**
 * A new secure link for a form sent to a lead (Intake Forms Review Two, ACCESS-01): the token goes
 * in the email only; the intake keeps its SHA-256 and the link's expiry, which is the form's own
 * expiration (intakes_access_token: never past it), else LEAD_LINK_DAYS from now. A new link
 * replaces the older one and the cookies opened from it (IntakeLinkService).
 */
export function newLeadLink(formExpiresAt: Date | null) {
  const { token, hash } = newResumeToken();
  return {
    token,
    data: {
      accessTokenHash: hash,
      accessTokenExpiresAt: formExpiresAt ?? new Date(Date.now() + LEAD_LINK_DAYS * 86_400_000),
    },
  };
}

/**
 * Emails the lead its link (`intake.lead-link`) after the send committed: the form's title, the
 * member's subject and message, and when the link stops working. False when it was not sent; the
 * form stays sent, and the caller records the failure. The log has the intake's id only.
 */
export async function emailLeadLink(
  deps: { database: Database; notify: NotifyService; env: Env; logger: Logger },
  businessId: string,
  intakeId: string,
  token: string,
): Promise<boolean> {
  try {
    const found = await deps.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const intake = await tx.intake.findFirst({
        where: { businessId, id: intakeId },
        select: {
          messageSubject: true,
          messageBody: true,
          accessTokenExpiresAt: true,
          form: { select: { title: true } },
          lead: { select: { email: true } },
        },
      });
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      return intake && { intake, slug: firm.slug };
    });
    if (!found?.intake.lead || !found.intake.accessTokenExpiresAt) return false;
    const { intake, slug } = found;
    const portal = deps.env.PORTAL_BASE_URL.replace(/\/+$/, '');
    await deps.notify.send({
      template: 'intake.lead-link',
      to: intake.lead!.email,
      businessId,
      data: {
        formTitle: intake.form.title,
        link: `${portal}/${slug}/${INTAKE_LINK_PATH}#token=${token}`,
        expiresAt: intake.accessTokenExpiresAt!,
        subject: intake.messageSubject,
        message: intake.messageBody,
      },
    });
    return true;
  } catch (error) {
    deps.logger.warn(`Intake ${intakeId}: the lead's link was not sent (${errorName(error)})`);
    return false;
  }
}
