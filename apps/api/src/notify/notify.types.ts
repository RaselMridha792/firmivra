import type { NotificationCategory } from '@firmivra/types';

/**
 * NotifyService (R6): the one way the API sends email and SMS. Every stream calls
 * `notify.send({ template, to, businessId, data })`; R6 renders the template with the firm's
 * branding and hands it to SES (Mailpit locally) or SNS (the API log until the number is
 * registered). Notification preferences apply once step 5 lands.
 *
 * What may go into `data` (CLAUDE.md hard rule 4, SYSTEM-DESIGN "Messaging"): names, the firm's
 * name, dates, titles and links. Never a password, a full SSN or EIN, a bank number, an amount,
 * document content or another client's details. A one-time code or token goes only into the
 * template field made for it (`code`, `link`).
 */

/**
 * The firm's name in a firm template is always the name of the firm `businessId` names, read by
 * NotifyService under that firm's own scope; `firmName` is ignored. It stays optional only so
 * calls written against step 1 still compile; leave it out (R6 removes it after step 6).
 */
type IgnoredFirmName = {
  /** @deprecated Ignored: the name comes from `businessId`. */ firmName?: string;
};

/**
 * The data each template needs. Add a template here (and to TEMPLATE_CHANNEL and
 * TEMPLATE_SENDER) before using it.
 */
export interface NotifyTemplates {
  // ----- Staff (R2) -----
  /** Invite to a firm: activation link (`{APP_BASE_URL}/activate#token=...`), 7 days. */
  'staff.invite': IgnoredFirmName & { name: string; link: string; expiresAt: Date };

  // ----- Client portal (R3) -----
  /** The 6-digit code that verifies a sign-up's email. */
  'client.signup-email-code': IgnoredFirmName & { code: string };
  /** The 6-digit code that verifies a sign-up's phone. */
  'client.signup-sms-code': IgnoredFirmName & { code: string };
  /** Sent instead of a code when the email already has an account at this firm. */
  'client.already-registered': IgnoredFirmName & { signInLink: string };
  /** The firm approved the client's sign-up. */
  'client.signup-approved': IgnoredFirmName & { name: string; signInLink: string };
  /** The firm declined it. No reason goes to the client (Rasel, q18). */
  'client.signup-declined': IgnoredFirmName & { name: string };

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
  'document.requested': IgnoredFirmName & {
    name: string;
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
  'invoice.sent': IgnoredFirmName & { name: string; invoiceNumber: string; link: string };
  'payment.received': IgnoredFirmName & { name: string; invoiceNumber: string; link: string };
}

export interface AppointmentData extends IgnoredFirmName {
  name: string;
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
 * Who a template comes from: `platform` is Firmivra's own (businessId null, Firmivra's branding),
 * `firm` is a firm's (its businessId, name and colours). NotifyService refuses a message whose
 * businessId does not fit, so a caller can never send one brand's email in the other's look.
 */
export type NotifySender = 'firm' | 'platform';

export const TEMPLATE_SENDER: Readonly<Record<NotifyTemplate, NotifySender>> = {
  'staff.invite': 'firm',
  'client.signup-email-code': 'firm',
  'client.signup-sms-code': 'firm',
  'client.already-registered': 'firm',
  'client.signup-approved': 'firm',
  'client.signup-declined': 'firm',
  'firm-application.received': 'platform',
  'firm-application.info-requested': 'platform',
  'firm-application.approved': 'platform',
  'firm-application.declined': 'platform',
  'document.requested': 'firm',
  'appointment.booked': 'firm',
  'appointment.changed': 'firm',
  'appointment.reminder': 'firm',
  'invoice.sent': 'firm',
  'payment.received': 'firm',
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

/**
 * The preference category of each template (notification_preferences.category). ACCOUNT notices
 * ignore preferences, like ALWAYS_SENT: the database keeps no preference for them.
 */
export const TEMPLATE_CATEGORY: Readonly<Record<NotifyTemplate, NotificationCategory>> = {
  'staff.invite': 'ACCOUNT',
  'client.signup-email-code': 'ACCOUNT',
  'client.signup-sms-code': 'ACCOUNT',
  'client.already-registered': 'ACCOUNT',
  'client.signup-approved': 'ACCOUNT',
  'client.signup-declined': 'ACCOUNT',
  'firm-application.received': 'ACCOUNT',
  'firm-application.info-requested': 'ACCOUNT',
  'firm-application.approved': 'ACCOUNT',
  'firm-application.declined': 'ACCOUNT',
  'document.requested': 'DOCUMENTS',
  'appointment.booked': 'APPOINTMENTS',
  'appointment.changed': 'APPOINTMENTS',
  'appointment.reminder': 'APPOINTMENTS',
  'invoice.sent': 'BILLING',
  'payment.received': 'BILLING',
};

export interface NotifyMessage<T extends NotifyTemplate = NotifyTemplate> {
  template: T;
  /** An email address, or an E.164 phone number for an SMS template. */
  to: string;
  /**
   * The firm the message comes from: its name and branding in client emails, and its sender
   * name. Null for Firmivra's own messages (firm applications). TEMPLATE_SENDER says which; a
   * mismatch rejects with NotifyTemplateError.
   */
  businessId: string | null;
  /**
   * Who it is for, when they have an account: their notification preferences apply (except for
   * ALWAYS_SENT templates) once R6 step 5 lands; pass it already.
   */
  recipient?: { userId: string } | { clientAccountId: string };
  /** For example Firmivra support, for an information request. */
  replyTo?: string;
  data: NotifyTemplates[T];
}

export interface NotifyService {
  /**
   * Sends one message. Resolves once the provider (or, in a log mode, the API log) has it.
   * Rejects with NotifyDeliveryError when the provider refuses it or cannot be reached, and with
   * NotifyTemplateError or UnknownFirmError for a programming error (a template or data that does
   * not fit, a firm that does not exist). No error holds the address, the text or the data.
   * The caller decides what a failure means: usually its own flow stands, and it logs a warning
   * with its record's id (as R4 does), never the address.
   */
  send<T extends NotifyTemplate>(message: NotifyMessage<T>): Promise<void>;
}

/** Nest injection token: `@Inject(NOTIFY_SERVICE) private readonly notify: NotifyService`. */
export const NOTIFY_SERVICE = Symbol('NOTIFY_SERVICE');
