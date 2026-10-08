import { Logger } from '@nestjs/common';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import type { Database } from '@firmivra/db';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { type Branding, BrandingSource, UnknownFirmError } from './branding.js';
import type { NotifyConfig, Sender } from './config.js';
import {
  ALWAYS_SENT,
  type NotifyChannel,
  type NotifyMessage,
  type NotifyService,
  type NotifyTemplate,
  TEMPLATE_CATEGORY,
  TEMPLATE_CHANNEL,
  TEMPLATE_SENDER,
} from './notify.types.js';
import { PreferenceSource } from './preferences.js';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An error's class name when it looks like one (e.g. MessageRejected), never its message, with
 * its code when that is one of Node's or nodemailer's (ETIMEDOUT, ECONNECTION).
 */
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const shown = /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^E[A-Z]+$/.test(code) && code.length <= 32
    ? `${shown}:${code}`
    : shown;
}

export interface NotifyDeps {
  branding: Pick<BrandingSource, 'load'>;
  /** The recipient's notification preferences (R6 step 5). */
  preferences: Pick<PreferenceSource, 'allows'>;
  /** Null with EMAIL_MODE=log. */
  email: { transport: EmailTransport; from: Sender } | null;
  /** Null while texts go to the log. */
  sms: SmsTransport | null;
  /** The sites' origins (config's `linkOrigins`): the only places a link in a message may go. */
  linkOrigins: readonly string[];
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
    // A firm's template needs its firm, Firmivra's own needs none: never one brand in the other's look.
    if ((TEMPLATE_SENDER[template] === 'firm') !== (businessId !== null)) {
      throw new NotifyTemplateError(
        TEMPLATE_SENDER[template] === 'firm'
          ? `${template} needs the businessId of the firm it comes from`
          : `${template} is Firmivra's own: businessId must be null`,
      );
    }
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
    if (await this.skipped(message, channel, fail)) {
      this.logger.log(`${what} not sent: the recipient turned this off`);
      return;
    }

    let branding: Branding;
    try {
      branding = await this.deps.branding.load(businessId);
    } catch (error) {
      // A firm that does not exist is the caller's mistake; anything else (the database down) is
      // a failed delivery. Never the raw database error: it can carry the query's values.
      if (error instanceof UnknownFirmError) throw error;
      throw fail(`BrandingUnavailable:${errorName(error)}`);
    }
    const rendered = render(template, message.data, branding, {
      canReply: replyTo !== null,
      linkOrigins: this.deps.linkOrigins,
    });
    try {
      if (rendered.channel === 'email') {
        const email = this.deps.email;
        if (!email) {
          this.logger.log(`${what} written to the log only (EMAIL_MODE=log)`);
          return;
        }
        // Firm emails carry the firm's name (as the email shows it); Firmivra's own carry
        // EMAIL_FROM's name.
        const name = branding.isFirm ? rendered.fromName : (email.from.name ?? rendered.fromName);
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

  /**
   * R6 step 5: a message for someone with an account (`recipient`) is skipped when they switched
   * its category off on its channel. ALWAYS_SENT templates and the locked ACCOUNT category always
   * go out, and a message with no recipient (an address not yet anyone's) is never skipped.
   */
  private async skipped(
    message: NotifyMessage,
    channel: NotifyChannel,
    fail: (reason: string) => NotifyDeliveryError,
  ): Promise<boolean> {
    const { template, businessId, recipient } = message;
    if (!recipient || businessId === null || ALWAYS_SENT.has(template)) return false;
    const id = 'userId' in recipient ? recipient.userId : recipient.clientAccountId;
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new NotifyTemplateError('recipient must name a user or client account by its id');
    }
    try {
      return !(await this.deps.preferences.allows(
        businessId,
        recipient,
        TEMPLATE_CATEGORY[template],
        channel,
      ));
    } catch (error) {
      throw fail(`PreferencesUnavailable:${errorName(error)}`);
    }
  }
}

/**
 * SES and SNS calls give up after a few seconds, like SMTP's: callers await `send` before they
 * answer (R4's decline), so a stalled provider must not hold the request open. Without
 * throwOnRequestTimeout, @smithy/node-http-handler only logs a warning when requestTimeout passes
 * and the request waits on; with it, the request is destroyed with a TimeoutError (retried once).
 */
export const AWS_CLIENT = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 3_000, requestTimeout: 5_000, throwOnRequestTimeout: true },
} as const;

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
              ? new SesEmailTransport(new SESv2Client(AWS_CLIENT))
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
    preferences: new PreferenceSource(db),
    email: emailSide,
    sms:
      sms.mode === 'sns'
        ? new SnsSmsTransport(new SNSClient(AWS_CLIENT), sms.originationNumber)
        : null,
    linkOrigins: config.linkOrigins,
    logger,
  });
}
