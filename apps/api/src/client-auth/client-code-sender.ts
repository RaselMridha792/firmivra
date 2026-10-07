import { Logger } from '@nestjs/common';

/** Nest injection token for the ClientCodeSender. R6 provides the real email and SMS sender. */
export const CLIENT_CODE_SENDER = Symbol('CLIENT_CODE_SENDER');

type CodeMessage = { to: string; code: string; businessName: string };
type NoticeMessage = { to: string; businessName: string };
type ApprovedMessage = NoticeMessage & { signInUrl: string };

export interface ClientCodeSender {
  /** The 6-digit email code for a portal sign-up. */
  emailCode(message: CodeMessage): Promise<void>;
  /** The 6-digit SMS code (E.164 number). */
  smsCode(message: CodeMessage): Promise<void>;
  /**
   * Sent instead of a code when someone signs up with an email that already has an account at
   * this firm: the API answers the same either way, only the address owner learns which.
   */
  alreadyRegistered(message: NoticeMessage): Promise<void>;
  /** The firm approved the sign-up: the portal is open (link to the firm's sign-in page). */
  signUpApproved(message: ApprovedMessage): Promise<void>;
  /** The firm declined the sign-up. The reason stays with the firm; it is not sent. */
  signUpDeclined(message: NoticeMessage): Promise<void>;
}

/**
 * Stand-in until R6's sender (hard rule 4, as for staff invites): with AUTH_MODE=local
 * (development and test only) it logs the code, so developers can finish a sign-up. Anywhere
 * else it sends nothing and logs neither the code nor the address, so a sign-up cannot finish
 * on dev until R6 sends email and SMS.
 */
export class LogClientCodeSender implements ClientCodeSender {
  constructor(
    private readonly localMode: boolean,
    private readonly logger: Pick<Logger, 'log' | 'warn'> = new Logger('ClientCodeSender'),
  ) {}

  emailCode(m: CodeMessage): Promise<void> {
    return this.write(`Local email code for ${m.to}: ${m.code}`, 'email code');
  }

  smsCode(m: CodeMessage): Promise<void> {
    return this.write(`Local SMS code for ${m.to}: ${m.code}`, 'SMS code');
  }

  alreadyRegistered(m: NoticeMessage): Promise<void> {
    return this.write(`Local "already registered" email to ${m.to}`, '"already registered" email');
  }

  signUpApproved(m: ApprovedMessage): Promise<void> {
    return this.write(`Local "approved" email to ${m.to}: ${m.signInUrl}`, '"approved" email');
  }

  signUpDeclined(m: NoticeMessage): Promise<void> {
    return this.write(`Local "declined" email to ${m.to}`, '"declined" email');
  }

  private write(local: string, what: string): Promise<void> {
    if (this.localMode) this.logger.log(local);
    else this.logger.warn(`Client sign-up ${what} not sent: the sender arrives with R6`);
    return Promise.resolve();
  }
}
