import { Logger } from '@nestjs/common';
import type { ActivationEmail, ActivationMailer } from '../auth/activation-mailer.js';
import type { ClientCodeSender } from '../client-auth/client-code-sender.js';
import type { NotifyService } from './notify.types.js';

type Log = Pick<Logger, 'log' | 'warn'>;

/**
 * R6 step 6: R2's invite emails through NotifyService (`staff.invite`). Like the stand-in it
 * replaces, it never rejects: the invite stands and a failed send is logged with the invite's id
 * only (the person can be sent a new link).
 */
export class NotifyActivationMailer implements ActivationMailer {
  constructor(
    private readonly notify: NotifyService,
    private readonly logger: Log = new Logger('ActivationMailer'),
  ) {}

  async send(email: ActivationEmail): Promise<void> {
    try {
      await this.notify.send({
        template: 'staff.invite',
        to: email.to,
        businessId: email.businessId,
        data: { name: email.name, link: email.link, expiresAt: email.expiresAt },
      });
    } catch {
      this.logger.warn(`Activation email for invite ${email.inviteId} not sent`);
    }
  }
}

/**
 * R6 step 6: R3's sign-up codes and notices through NotifyService. Rejects as NotifyService does;
 * the callers catch and log the account's id. With AUTH_MODE=local (development and test only)
 * an SMS code is also written to the API log, since a local text goes only to the log without its
 * body (R6 Open: "Local SMS codes"); emails are read in Mailpit.
 */
export class NotifyClientCodeSender implements ClientCodeSender {
  constructor(
    private readonly notify: NotifyService,
    private readonly localMode: boolean,
    private readonly logger: Log = new Logger('ClientCodeSender'),
  ) {}

  emailCode(m: Parameters<ClientCodeSender['emailCode']>[0]): Promise<void> {
    return this.notify.send({
      template: 'client.signup-email-code',
      to: m.to,
      businessId: m.businessId,
      data: { code: m.code },
    });
  }

  async smsCode(m: Parameters<ClientCodeSender['smsCode']>[0]): Promise<void> {
    if (this.localMode) this.logger.log(`Local SMS code for ${m.to}: ${m.code}`);
    await this.notify.send({
      template: 'client.signup-sms-code',
      to: m.to,
      businessId: m.businessId,
      data: { code: m.code },
    });
  }

  alreadyRegistered(m: Parameters<ClientCodeSender['alreadyRegistered']>[0]): Promise<void> {
    return this.notify.send({
      template: 'client.already-registered',
      to: m.to,
      businessId: m.businessId,
      data: { signInLink: m.signInUrl },
    });
  }

  signUpApproved(m: Parameters<ClientCodeSender['signUpApproved']>[0]): Promise<void> {
    return this.notify.send({
      template: 'client.signup-approved',
      to: m.to,
      businessId: m.businessId,
      data: { name: m.name, signInLink: m.signInUrl },
    });
  }

  signUpDeclined(m: Parameters<ClientCodeSender['signUpDeclined']>[0]): Promise<void> {
    return this.notify.send({
      template: 'client.signup-declined',
      to: m.to,
      businessId: m.businessId,
      data: { name: m.name },
    });
  }
}
