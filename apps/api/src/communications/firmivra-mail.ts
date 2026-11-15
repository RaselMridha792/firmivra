import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { Sender } from '../notify/config.js';
import type { EmailTransport } from '../notify/transports.js';
import {
  type CommunicationProvider,
  type CommunicationProviders,
  type DeliveryMessage,
  DeliveryError,
} from './communications-provider.js';

// Leads Review Two, row 14: Firmivra Mail, the built-in email channel for campaigns. A firm needs
// no outside account: the campaign's email goes out through the platform's own mailer (SES in AWS,
// Mailpit locally), from the firm's name. On a test site nothing reaches a real client by mistake:
// until COMMUNICATIONS_MAIL=live, an email goes only to the firm's own team (an ACTIVE member's
// login email, exactly) or to an address in COMMUNICATIONS_TEST_RECIPIENTS (exact emails only,
// never a domain); every other recipient is held, recorded as not sent, and never sent.

/** The integration provider code of the built-in channel. */
export const FIRMIVRA_MAIL = 'firmivra_mail';
/** The connection's name as the firm sees it. */
export const FIRMIVRA_MAIL_LABEL = 'Firmivra Mail';
/** A held recipient's failure code (the results say "Held on this test site"). */
export const HELD_ON_DEV = 'held_on_dev';
/** What the builder and the results say while the channel holds. */
export const HOLD_NOTE = 'On this test site, emails go only to your firm’s own team addresses.';

/** What the builder and the results say about a connection's emails: the note while it holds. */
export function holdNoteOf(
  providers: Pick<CommunicationProviders, 'get'>,
  provider: string | null | undefined,
): string | null {
  const mail = providers.get(FIRMIVRA_MAIL);
  return provider === FIRMIVRA_MAIL && mail instanceof FirmivraMailProvider && mail.mode === 'hold'
    ? HOLD_NOTE
    : null;
}

/** The campaign mailer: the platform's transport and From address; null with EMAIL_MODE=log. */
export interface CampaignMailer {
  transport: EmailTransport;
  from: Sender;
}
/** Nest token for the CampaignMailer (tests give their own). */
export const CAMPAIGN_MAILER = Symbol('CAMPAIGN_MAILER');

export type CampaignMailMode = 'live' | 'hold';

/** COMMUNICATIONS_MAIL=live sends to everyone; anything else (or nothing) holds. */
export function campaignMailMode(env: NodeJS.ProcessEnv = process.env): CampaignMailMode {
  return env['COMMUNICATIONS_MAIL'] === 'live' ? 'live' : 'hold';
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * COMMUNICATIONS_TEST_RECIPIENTS: comma-separated exact email addresses that still get campaign
 * emails while the channel holds. A domain ("@example.com", "example.com") is ignored, so a list
 * can never let a whole provider's clients through.
 */
export function testRecipients(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env['COMMUNICATIONS_TEST_RECIPIENTS'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => EMAIL.test(s)),
  );
}

/** A plain-text copy of the campaign's HTML for mail clients that show text. */
export function textOf(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class FirmivraMailProvider implements CommunicationProvider {
  readonly provider = FIRMIVRA_MAIL;
  readonly channel = 'EMAIL' as const;
  /** The platform mailer reports no opens or clicks back (the results say so). */
  readonly supports = { opens: false, clicks: false };
  private readonly logger = new Logger('FirmivraMail');

  constructor(
    private readonly database: Pick<Database, 'forBusiness'>,
    private readonly mail: CampaignMailer | null,
    readonly mode: CampaignMailMode,
    private readonly allowList: ReadonlySet<string>,
  ) {}

  async send(message: DeliveryMessage): Promise<{ messageId: string }> {
    if (this.mode === 'hold' && !(await this.allowed(message.businessId, message.to))) {
      throw new DeliveryError(HELD_ON_DEV, false);
    }
    const messageId = `firmivra-mail-${randomUUID()}`;
    if (!this.mail) {
      // EMAIL_MODE=log (development and test only): nothing leaves; ids only in the log.
      this.logger.log(`campaign email for firm ${message.businessId} (EMAIL_MODE=log, not sent)`);
      return { messageId };
    }
    try {
      await this.mail.transport.send({
        // The firm's name on the platform's own address.
        from: { name: message.fromName, address: this.mail.from.address },
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject ?? '',
        html: message.body,
        text: textOf(message.body),
      });
    } catch {
      throw new DeliveryError('provider_error', true);
    }
    return { messageId };
  }

  /** The firm's own team (an ACTIVE member's login, exactly), or a listed test address. */
  private async allowed(businessId: string, to: string): Promise<boolean> {
    const email = to.trim().toLowerCase();
    if (this.allowList.has(email)) return true;
    const member = await this.database.forBusiness(businessId).membership.findFirst({
      where: {
        businessId,
        status: 'ACTIVE',
        user: { email: { equals: email, mode: 'insensitive' } },
      },
      select: { userId: true },
    });
    return member !== null;
  }
}
