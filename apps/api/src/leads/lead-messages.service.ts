import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { LeadBulkResult, LeadMessageRequest } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { NotifyDeliveryError } from '../notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { LeadEmailService } from './lead-email.service.js';
import { invalid, type PipelineActor, reach, toE164, visibleLead } from './pipeline.shared.js';

type Body = z.output<typeof LeadMessageRequest>;

const BATCH = 10;

/**
 * Send Email and Send SMS from the Leads page (R57), through NotifyService like every other
 * message. The text goes to the provider and nowhere else: the lead's activity holds an email's
 * subject, never a body, and no log line or audit row holds an address, a number or any text.
 */
@Injectable()
export class LeadMessagesService {
  private readonly logger = new Logger(LeadMessagesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(NOTIFY_CONFIG) private readonly config: NotifyConfig,
    private readonly audit: AuditService,
    private readonly email: LeadEmailService,
  ) {}

  async send(businessId: string, actor: PipelineActor, body: Body): Promise<LeadBulkResult> {
    const ids = [...new Set(body.ids)];
    const sms = body.channel === 'SMS';
    // SMS_MODE=sns without the registered number: texts would not leave the API.
    if (sms && this.config.sms.mode === 'log' && this.config.sms.unregistered) {
      throw invalid('Text messages are not set up for this firm yet', 'SMS_UNAVAILABLE');
    }
    const leads = await this.database.forBusiness(businessId).lead.findMany({
      where: {
        AND: [visibleLead(businessId), reach(actor), { id: { in: ids }, archivedAt: null }],
      },
      select: { id: true, firstName: true, email: true, phone: true },
    });
    const targets = leads.map((l) => ({ ...l, to: sms ? toE164(l.phone) : l.email }));
    // A formatted email, cleaned to the composer's rules with this firm's images only (L4).
    const html =
      !sms && body.html !== undefined
        ? await this.email.cleanForSending(businessId, body.html)
        : null;
    if (sms && leads.length > 0 && targets.every((t) => t.to === null)) {
      throw invalid('These leads have no phone number', 'SMS_UNAVAILABLE');
    }
    const sent: string[] = [];
    for (let i = 0; i < targets.length; i += BATCH) {
      await Promise.all(
        targets.slice(i, i + BATCH).map(async (t) => {
          if (t.to === null) return;
          try {
            if (sms) {
              await this.notify.send({
                template: 'lead.message-sms',
                to: t.to,
                businessId,
                data: { body: body.body },
              });
            } else {
              await this.notify.send({
                template: 'lead.message-email',
                to: t.to,
                businessId,
                data: { name: t.firstName, subject: body.subject ?? null, body: body.body, html },
              });
            }
            sent.push(t.id);
          } catch (error) {
            if (!(error instanceof NotifyDeliveryError)) throw error;
            this.logger.warn(`Lead ${t.id}: the ${body.channel} was not sent`); // ids only
          }
        }),
      );
    }
    if (sent.length > 0) {
      await this.database.withScope({ kind: 'business', businessId }, (tx) =>
        tx.leadActivity.createMany({
          data: sent.map((leadId) => ({
            businessId,
            leadId,
            kind: sms ? ('SMS_SENT' as const) : ('EMAIL_SENT' as const),
            actorUserId: actor.userId,
            summary: sms ? null : (body.subject ?? null),
            metadata: { channel: body.channel },
          })),
        }),
      );
    }
    for (const id of sent) {
      await this.audit.log('lead.message_sent', { type: 'lead', id }, { channel: body.channel });
    }
    return { changed: sent.length, skipped: ids.length - sent.length };
  }
}
