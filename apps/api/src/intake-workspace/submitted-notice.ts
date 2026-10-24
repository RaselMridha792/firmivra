import type { Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { Env } from '../config/env.js';
import type { NotifyService } from '../notify/notify.types.js';

// Intake Form Settings > Notify additional emails (Octavia's I7): when a client submits an intake
// form, the addresses the firm listed get a short notice with the form's title and a link to the
// workspace. No client name and no answers: the address may be anyone's. Assigned staff and the
// firm keep their own bell items (the Notifier's intake.submitted).

export interface SubmittedNoticeDeps {
  database: Database;
  notify: NotifyService;
  env: Env;
  logger: Logger;
}

/**
 * Sends the notice to each listed address after the submit committed. A failed send is logged
 * with the intake's id only and never undoes the submit.
 */
export async function sendSubmittedNotice(
  deps: SubmittedNoticeDeps,
  businessId: string,
  intakeId: string,
): Promise<void> {
  try {
    const { emails, title } = await deps.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const [settings, intake] = await Promise.all([
          tx.intakeSettings.findUnique({
            where: { businessId },
            select: { notifyAdditionalEmails: true },
          }),
          tx.intake.findFirst({
            where: { businessId, id: intakeId },
            select: { form: { select: { title: true } } },
          }),
        ]);
        return {
          emails: settings?.notifyAdditionalEmails ?? [],
          title: intake?.form?.title ?? 'An intake form',
        };
      },
    );
    if (emails.length === 0) return;
    const link = `${deps.env.APP_BASE_URL.replace(/\/+$/, '')}/intake-forms`;
    const results = await Promise.allSettled(
      emails.map((to) =>
        deps.notify.send({
          template: 'intake.submitted-notice',
          to,
          businessId,
          data: { formTitle: title, link },
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0)
      deps.logger.warn(`Intake ${intakeId}: ${failed} additional notice email(s) not sent`);
  } catch (error) {
    deps.logger.warn(
      `Intake ${intakeId}: additional notice not sent (${(error as Error)?.name ?? 'Error'})`,
    );
  }
}
