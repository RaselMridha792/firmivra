/**
 * NotifyService (R6): the one way the API sends email and SMS. Every stream calls
 * `notify.send({ template, to, businessId, data })`; R6 renders the template with the firm's
 * branding, checks the recipient's preferences and hands it to SES (Mailpit locally) or SNS (the
 * API log until SNS is registered).
 *
 * What may go into `data` (CLAUDE.md hard rule 4, SYSTEM-DESIGN "Messaging"): names, the firm's
 * name, dates, titles and links. Never a password, a full SSN or EIN, a bank number, an amount,
 * document content or another client's details. A one-time code or token goes only into the
 * template field made for it (`code`, `link`).
 */

/** The data each template needs. Add a template here (and to TEMPLATE_CHANNEL) before using it. */
export interface NotifyTemplates {
  // ----- Staff (R2) -----
  /** Invite to a firm: activation link (`{APP_BASE_URL}/activate#token=...`), 7 days. */
  'staff.invite': { name: string; firmName: string; link: string; expiresAt: Date };

  // ----- Client portal (R3) -----
  /** The 6-digit code that verifies a sign-up's email. */
  'client.signup-email-code': { firmName: string; code: string };
  /** The 6-digit code that verifies a sign-up's phone. */
  'client.signup-sms-code': { firmName: string; code: string };
  /** Sent instead of a code when the email already has an account at this firm. */
  'client.already-registered': { firmName: string; signInLink: string };
  /** The firm approved the client's sign-up. */
  'client.signup-approved': { name: string; firmName: string; signInLink: string };
  /** The firm declined it; the reason is what the firm wrote for the client, if anything. */
  'client.signup-declined': { name: string; firmName: string; reason: string | null };

  // ----- Firm applications (R4; Firmivra's own messages, businessId null) -----
  'firm-application.received': { name: string; legalName: string };
  /** Request Information: the applicant replies to Firmivra support (`replyTo`). */
  'firm-application.info-requested': { name: string; legalName: string; message: string };
  /** Approved: the owner's activation link (R2 invite), 7 days. */
  'firm-application.approved': { name: string; legalName: string; link: string; expiresAt: Date };
  /** Declined, with the reason the Super Admin wrote for the applicant. */
  'firm-application.declined': { name: string; legalName: string; reason: string };

  // ----- Documents (R5) -----
  /** The firm asks for a document (no content; the client opens the portal to see it). */
  'document.requested': {
    name: string;
    firmName: string;
    title: string;
    /** YYYY-MM-DD in the firm's calendar, or null. */
    dueOn: string | null;
    link: string;
  };

  // ----- Appointments (R12) -----
  'appointment.booked': AppointmentData;
  'appointment.changed': AppointmentData;
  'appointment.reminder': AppointmentData;

  // ----- Invoices (R7; no amounts in messages) -----
  'invoice.sent': { name: string; firmName: string; invoiceNumber: string; link: string };
  'payment.received': { name: string; firmName: string; invoiceNumber: string; link: string };
}

export interface AppointmentData {
  name: string;
  firmName: string;
  /** What the appointment is, e.g. "Tax review". */
  title: string;
  startsAt: Date;
  /** The firm's time zone (IANA), so the time reads as the firm means it. */
  timeZone: string;
  link: string;
}

export type NotifyTemplate = keyof NotifyTemplates;
export type NotifyChannel = 'email' | 'sms';

/** The channel each template goes out on. */
export const TEMPLATE_CHANNEL: Readonly<Record<NotifyTemplate, NotifyChannel>> = {
  'staff.invite': 'email',
  'client.signup-email-code': 'email',
  'client.signup-sms-code': 'sms',
  'client.already-registered': 'email',
  'client.signup-approved': 'email',
  'client.signup-declined': 'email',
  'firm-application.received': 'email',
  'firm-application.info-requested': 'email',
  'firm-application.approved': 'email',
  'firm-application.declined': 'email',
  'document.requested': 'email',
  'appointment.booked': 'email',
  'appointment.changed': 'email',
  'appointment.reminder': 'email',
  'invoice.sent': 'email',
  'payment.received': 'email',
};

/**
 * Codes, invites and approvals reach the person whatever their notification preferences say
 * (they are part of signing in or of a decision about them).
 */
export const ALWAYS_SENT: ReadonlySet<NotifyTemplate> = new Set<NotifyTemplate>([
  'staff.invite',
  'client.signup-email-code',
  'client.signup-sms-code',
  'client.already-registered',
  'client.signup-approved',
  'client.signup-declined',
  'firm-application.received',
  'firm-application.info-requested',
  'firm-application.approved',
  'firm-application.declined',
]);

export interface NotifyMessage<T extends NotifyTemplate = NotifyTemplate> {
  template: T;
  /** An email address, or an E.164 phone number for an SMS template. */
  to: string;
  /**
   * The firm the message comes from: its name and branding in client emails, and its sender
   * name. Null for Firmivra's own messages (firm applications).
   */
  businessId: string | null;
  /**
   * Who it is for, when they have an account: their notification preferences apply (except for
   * ALWAYS_SENT templates).
   */
  recipient?: { userId: string } | { clientAccountId: string };
  /** For example Firmivra support, for an information request. */
  replyTo?: string;
  data: NotifyTemplates[T];
}

export interface NotifyService {
  /**
   * Sends one message, or skips it when the recipient's preferences turn it off. Resolves once
   * the provider (or the local log) has it. A delivery failure is logged (without the address or
   * the data) and does not reject, so a caller's flow never depends on email; it rejects only for
   * a programming error, such as a template that does not exist.
   */
  send<T extends NotifyTemplate>(message: NotifyMessage<T>): Promise<void>;
}

/** Nest injection token: `@Inject(NOTIFY_SERVICE) private readonly notify: NotifyService`. */
export const NOTIFY_SERVICE = Symbol('NOTIFY_SERVICE');
