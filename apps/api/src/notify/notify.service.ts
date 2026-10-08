import { Logger } from '@nestjs/common';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import type { Database } from '@firmivra/db';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { BrandingSource } from './branding.js';
import type { NotifyConfig, Sender } from './config.js';
import {
  type NotifyChannel,
  type NotifyMessage,
  type NotifyService,
  type NotifyTemplate,
  TEMPLATE_CHANNEL,
} from './notify.types.js';
import { NotifyTemplateError, render } from './templates.js';
import {
  type EmailTransport,
  SesEmailTransport,
  type SmsTransport,
  SmtpEmailTransport,
  SnsSmsTransport,
} from './transports.js';

/**
 * The message did not go out: the provider refused it or could not be reached, or the address
 * cannot be one. It names the template and the provider's error name, never the address, the
 * text or the provider's own message (which may quote the address).
 */
export class NotifyDeliveryError extends Error {
  constructor(
    readonly template: NotifyTemplate,
    readonly channel: NotifyChannel,
    readonly reason: string,
  ) {
    super(`The ${channel} "${template}" could not be sent (${reason})`);
    this.name = 'NotifyDeliveryError';
  }
}

const EMAIL = z.email();
const PHONE = /^\+[1-9]\d{6,14}$/;

/** An error's class name when it looks like one (e.g. MessageRejected), never its message. */
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
}

export interface NotifyDeps {
  branding: Pick<BrandingSource, 'load'>;
  /** Null with EMAIL_MODE=log. */
  email: { transport: EmailTransport; from: Sender } | null;
  /** Null while texts go to the log. */
  sms: SmsTransport | null;
  logger?: Pick<Logger, 'log' | 'warn'>;
}

/**
 * Renders a template with the sender's branding and hands it to the provider. Its log lines hold
 * the channel, the template, the firm's id and an error name only: never an address, a phone
 * number, a subject or a body (hard rule 4).
 */
export class SendingNotifyService implements NotifyService {
  private readonly logger: Pick<Logger, 'log' | 'warn'>;

  constructor(private readonly deps: NotifyDeps) {
    this.logger = deps.logger ?? new Logger('NotifyService');
  }

  async send<T extends NotifyTemplate>(message: NotifyMessage<T>): Promise<void> {
    const { template, businessId } = message;
    const channel = TEMPLATE_CHANNEL[template] as NotifyChannel | undefined;
    if (!channel) throw new NotifyTemplateError(`Unknown template ${template}`);
    const what = `${channel} "${template}" (${businessId ? `firm ${businessId}` : 'Firmivra'})`;
    const fail = (reason: string) => {
      this.logger.warn(`${what} not sent: ${reason}`);
      return new NotifyDeliveryError(template, channel, reason);
    };

    const to = typeof message.to === 'string' ? message.to.trim() : '';
    const valid = channel === 'sms' ? PHONE.test(to) : EMAIL.safeParse(to).success;
    if (!valid) throw fail('InvalidRecipient');
    const replyTo = message.replyTo?.trim() || null;
    if (replyTo !== null && !EMAIL.safeParse(replyTo).success) {
      throw new NotifyTemplateError('replyTo must be an email address');
    }

    const branding = await this.deps.branding.load(businessId);
    const rendered = render(template, message.data, branding, { canReply: replyTo !== null });
    try {
      if (rendered.channel === 'email') {
        const email = this.deps.email;
        if (!email) {
          this.logger.log(`${what} written to the log only (EMAIL_MODE=log)`);
          return;
        }
        // Firm emails carry the firm's name; Firmivra's own carry EMAIL_FROM's name.
        const name = branding.isFirm ? branding.name : (email.from.name ?? branding.name);
        await email.transport.send({
          from: { name, address: email.from.address },
          to,
          replyTo,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
      } else {
        if (!this.deps.sms) {
          this.logger.log(`${what} written to the log only (no registered SMS number)`);
          return;
        }
        await this.deps.sms.send({ to, text: rendered.text });
      }
    } catch (error) {
      throw fail(errorName(error));
    }
    this.logger.log(`${what} sent`);
  }
}

/** The service for the settings: SES or Mailpit, SNS or the log. */
export function createNotifyService(
  config: NotifyConfig,
  db: Pick<Database, 'forBusiness'>,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('NotifyService'),
): NotifyService {
  const { email, sms } = config;
  const emailSide: NotifyDeps['email'] =
    email.mode === 'log'
      ? null
      : {
          from: email.from,
          transport:
            email.mode === 'ses'
              ? new SesEmailTransport(new SESv2Client({}), email.configurationSet)
              : new SmtpEmailTransport(
                  createTransport({
                    host: email.host,
                    port: email.port,
                    secure: false,
                    ignoreTLS: true,
                    connectionTimeout: 5_000,
                    greetingTimeout: 5_000,
                    socketTimeout: 10_000,
                  }),
                ),
        };
  if (sms.mode === 'log' && sms.unregistered) {
    logger.warn('SMS_MODE=sns without SMS_ORIGINATION_NUMBER: texts go to the log, not sent');
  }
  return new SendingNotifyService({
    branding: new BrandingSource(db),
    email: emailSide,
    sms: sms.mode === 'sns' ? new SnsSmsTransport(new SNSClient({}), sms.originationNumber) : null,
    logger,
  });
}
