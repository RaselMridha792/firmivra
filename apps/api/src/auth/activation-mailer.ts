import { Logger } from '@nestjs/common';

/** Nest injection token for the ActivationMailer. R6 provides the real email sender. */
export const ACTIVATION_MAILER = Symbol('ACTIVATION_MAILER');

export interface ActivationEmail {
  inviteId: string;
  to: string;
  name: string;
  businessName: string;
  /** `/activate#token=...`: holds the one-time token, so it is never logged outside local mode. */
  link: string;
  expiresAt: Date;
}

export interface ActivationMailer {
  send(email: ActivationEmail): Promise<void>;
}

/**
 * Stand-in until R6's email sender. With AUTH_MODE=local (development and test only; the config
 * refuses it in production) it logs the link, so developers can activate synthetic users.
 * Anywhere else it sends nothing and logs neither the token nor the email address.
 */
export class LogActivationMailer implements ActivationMailer {
  constructor(
    private readonly localMode: boolean,
    private readonly logger: Pick<Logger, 'log' | 'warn'> = new Logger('ActivationMailer'),
  ) {}

  send(email: ActivationEmail): Promise<void> {
    if (this.localMode) {
      this.logger.log(`Local activation link for ${email.to}: ${email.link}`);
    } else {
      this.logger.warn(
        `Activation email for invite ${email.inviteId} not sent: the email sender arrives with R6`,
      );
    }
    return Promise.resolve();
  }
}
