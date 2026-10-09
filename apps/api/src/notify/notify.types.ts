import type { EsignEventType, NotificationCategory } from '@firmivra/types';

/**
 * NotifyService (R6): the one way the API sends email and SMS. Every stream calls
 * `notify.send({ template, to, businessId, data })`; R6 renders the template with the firm's
 * branding and hands it to SES (Mailpit locally) or SNS (the API log until the number is
 * registered). The recipient's notification preferences apply (step 5).
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

  // ----- Begin Online, leads and messages (R11) -----
  /**
   * The visitor's link back to their Begin Online draft (`{PORTAL_BASE_URL}/{slug}/begin/resume
   * #token=...`). Nothing the visitor typed goes in: the address is not verified.
   */
  'begin-online.resume-link': IgnoredFirmName & { link: string; expiresAt: Date };
  /** To the visitor after they send a request. Fixed text and the firm's own service name only. */
  'lead.confirmation': IgnoredFirmName & { serviceName: string };
  /** To the firm's owner and admins: a new Begin Online request. No answers and no names. */
  'lead.received': IgnoredFirmName & { serviceName: string; link: string };
  /** The firm converted the lead: an invitation to sign up on the client portal. */
  'client.portal-invite': IgnoredFirmName & { name: string; signUpLink: string };
  /** A new message in a thread. Never the message text: the reader opens the link. */
  'message.received': IgnoredFirmName & { name: string; link: string };

  // ----- Firm applications (R4; Firmivra's own messages, businessId null) -----
  /**
   * No data: the address is not verified yet, so nothing the applicant typed goes into this email
   * (it would let anyone send Firmivra-signed text to any inbox).
   */
  'firm-application.received': Record<string, never>;
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

  // ----- Firm Sign (R13): titles, names, dates, links and the sender's own note on a request;
  // never a field value, document content or a decline or void reason -----
  /**
   * Asks a recipient to sign. `link` is `{PORTAL_BASE_URL}/{slug}/sign#t=<token>`: it carries the
   * token, so never log it. `message` is the sender's own note (capped at 1000 characters).
   */
  'esign.request': EsignRecipientData & { senderName: string; message: string | null };
  /** The 6-digit code that opens a signing link, valid 15 minutes. */
  'esign.code': { code: string; title: string };
  'esign.reminder': EsignRecipientData;
  /** The request expires at `expiresAt` (shown in the firm's time zone). */
  'esign.expiring': EsignRecipientData & { expiresAt: Date };
  /**
   * Everyone signed. An external signer gets `copyLink` (read-only copy, 30 days); a portal
   * client gets `portalLink` instead.
   */
  'esign.completed': EsignNamed &
    ({ copyLink: string; portalLink?: never } | { portalLink: string; copyLink?: never });
  /** To the sender. Never the decline reason: it can hold client content. `link`: the workspace. */
  'esign.declined': EsignNamed & { signerName: string; link: string };
  /** To the recipients: the firm cancelled it. No reason. */
  'esign.voided': EsignNamed;
  /** To an internal approver. `link`: the request in the workspace. */
  'esign.approval-requested': EsignNamed & { senderName: string; link: string };
  /**
   * To the sender: what happened. `signerName` for VIEWED and SIGNED; `waitingOn` (SIGNED only)
   * names the signers whose turn it is now ("Waiting on Another Signer", spec section 23).
   */
  'esign.staff-update': EsignNamed & {
    event: EsignStaffEvent;
    signerName?: string | null;
    waitingOn?: string[] | null;
    link: string;
  };
}

/** The person the email is for (their name, or empty for "Hello,") and the request's title. */
export interface EsignNamed {
  name: string;
  /** The request's title (capped at 200 characters). */
  title: string;
}

export interface EsignRecipientData extends EsignNamed {
  /** The signing link (carries the token: never log it). */
  link: string;
}

/** The timeline events a sender is told about (declined has its own template). */
export const ESIGN_STAFF_EVENTS = [
  'VIEWED',
  'SIGNED',
  'COMPLETED',
  'EXPIRED',
] as const satisfies readonly EsignEventType[];
export type EsignStaffEvent = (typeof ESIGN_STAFF_EVENTS)[number];

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
  'esign.request': 'email',
  'esign.code': 'email',
  'esign.reminder': 'email',
  'esign.expiring': 'email',
  'esign.completed': 'email',
  'esign.declined': 'email',
  'esign.voided': 'email',
  'esign.approval-requested': 'email',
  'esign.staff-update': 'email',
  'begin-online.resume-link': 'email',
  'lead.confirmation': 'email',
  'lead.received': 'email',
  'client.portal-invite': 'email',
  'message.received': 'email',
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
  'esign.request': 'firm',
  'esign.code': 'firm',
  'esign.reminder': 'firm',
  'esign.expiring': 'firm',
  'esign.completed': 'firm',
  'esign.declined': 'firm',
  'esign.voided': 'firm',
  'esign.approval-requested': 'firm',
  'esign.staff-update': 'firm',
  'begin-online.resume-link': 'firm',
  'lead.confirmation': 'firm',
  'lead.received': 'firm',
  'client.portal-invite': 'firm',
  'message.received': 'firm',
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
  // Firm Sign: the code, a request to sign and its expiry warning are part of a transaction the
  // recipient is in the middle of; reminders and the rest follow preferences.
  'esign.code',
  'esign.request',
  'esign.expiring',
  // A Begin Online visitor has no account, so no preferences; an invitation is a decision.
  'begin-online.resume-link',
  'lead.confirmation',
  'client.portal-invite',
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
  // No e-sign category yet: Firm Sign notices are document notices, except the always-sent ones.
  'esign.request': 'ACCOUNT',
  'esign.code': 'ACCOUNT',
  'esign.reminder': 'DOCUMENTS',
  'esign.expiring': 'ACCOUNT',
  'esign.completed': 'DOCUMENTS',
  'esign.declined': 'DOCUMENTS',
  'esign.voided': 'DOCUMENTS',
  'esign.approval-requested': 'DOCUMENTS',
  'esign.staff-update': 'DOCUMENTS',
  'begin-online.resume-link': 'ACCOUNT',
  'lead.confirmation': 'ACCOUNT',
  'lead.received': 'INTAKE',
  'client.portal-invite': 'ACCOUNT',
  'message.received': 'MESSAGES',
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
   * Who it is for, when they have an account: the message is skipped (resolves, nothing sent)
   * when they switched its category (TEMPLATE_CATEGORY) off on its channel. ALWAYS_SENT templates
   * and ACCOUNT notices ignore preferences. Without it, nothing is skipped.
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
