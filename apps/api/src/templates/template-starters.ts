import type { MessageTemplateKind } from '@firmivra/types';

// The 48 starter templates every firm can install (idempotent, by `key`). Plain wording with
// merge fields; a firm edits them freely after they are installed. SMS and task checklists are
// plain text, the rest simple HTML. No real names, numbers or amounts: synthetic examples only.

export interface Starter {
  /** Stable, unique in the list: it is the template's starterKey. */
  key: string;
  kind: MessageTemplateKind;
  /** The firm category it is placed in (made when missing). */
  category: string;
  name: string;
  subject?: string;
  body: string;
}

const html = (...paragraphs: string[]) => paragraphs.map((p) => `<p>${p}</p>`).join('');
const sign = '<p>Thank you,<br>[Staff Name]<br>[Business Name]</p>';
const hello = 'Hello [Client First Name],';

export const STARTERS: readonly Starter[] = [
  // ----- Email (8) -----
  {
    key: 'email-welcome',
    kind: 'EMAIL',
    category: 'Onboarding',
    name: 'New Client Welcome',
    subject: 'Welcome to [Business Name]',
    body:
      html(
        hello,
        'Welcome to [Business Name]. We are glad you chose us and look forward to working with you.',
        'You can reach your secure client portal at [Client Portal Link] to upload documents and message us.',
      ) + sign,
  },
  {
    key: 'email-follow-up',
    kind: 'EMAIL',
    category: 'General',
    name: 'General Follow-Up',
    subject: 'Following up from [Business Name]',
    body:
      html(
        hello,
        'I wanted to follow up on our recent conversation. Please let me know if you have any questions.',
      ) + sign,
  },
  {
    key: 'email-thank-you',
    kind: 'EMAIL',
    category: 'General',
    name: 'Thank You',
    subject: 'Thank you from [Business Name]',
    body:
      html(hello, 'Thank you for trusting us with your work. It is a pleasure to help you.') + sign,
  },
  {
    key: 'email-missing-info',
    kind: 'EMAIL',
    category: 'Documents',
    name: 'Missing Information',
    subject: 'We need a little more information',
    body:
      html(
        hello,
        'To keep your work moving, we still need a few items from you. You can upload them at [Document Upload Link].',
      ) + sign,
  },
  {
    key: 'email-return-ready',
    kind: 'EMAIL',
    category: 'Tax Season',
    name: 'Tax Return Ready for Review',
    subject: 'Your [Tax Year] return is ready for review',
    body:
      html(
        hello,
        'Your [Tax Year] [Return Type] return is ready. Please review it in your portal: [Client Portal Link].',
      ) + sign,
  },
  {
    key: 'email-signature-request',
    kind: 'EMAIL',
    category: 'Tax Season',
    name: 'Signature Request',
    subject: 'Please sign your documents',
    body:
      html(
        hello,
        'Your documents are ready for your signature. Please sign them here: [Signature Link].',
      ) + sign,
  },
  {
    key: 'email-office-closed',
    kind: 'EMAIL',
    category: 'General',
    name: 'Office Closure Notice',
    subject: 'Our office hours are changing',
    body:
      html(
        hello,
        'Please note our office hours are changing. You can always reach us through your portal: [Client Portal Link].',
      ) + sign,
  },
  {
    key: 'email-referral',
    kind: 'EMAIL',
    category: 'General',
    name: 'Referral Request',
    subject: 'Know someone we can help?',
    body:
      html(
        hello,
        'If you know someone who could use our help, we would be grateful for the introduction. Thank you for your trust.',
      ) + sign,
  },

  // ----- SMS (6) -----
  {
    key: 'sms-appointment-reminder',
    kind: 'SMS',
    category: 'Appointments',
    name: 'Appointment Reminder',
    body: '[Business Name]: reminder of your [Appointment Type] on [Appointment Date] at [Appointment Time].',
  },
  {
    key: 'sms-docs-reminder',
    kind: 'SMS',
    category: 'Documents',
    name: 'Document Reminder',
    body: '[Business Name]: please upload your documents at [Document Upload Link]. Thank you.',
  },
  {
    key: 'sms-invoice-reminder',
    kind: 'SMS',
    category: 'Payments',
    name: 'Invoice Reminder',
    body: '[Business Name]: invoice [Invoice Number] is due [Due Date]. Pay here: [Payment Link].',
  },
  {
    key: 'sms-return-ready',
    kind: 'SMS',
    category: 'Tax Season',
    name: 'Return Ready',
    body: '[Business Name]: your [Tax Year] return is ready. See your portal: [Client Portal Link].',
  },
  {
    key: 'sms-thank-you',
    kind: 'SMS',
    category: 'General',
    name: 'Thank You Text',
    body: '[Business Name]: thank you, [Client First Name]. We appreciate your trust.',
  },
  {
    key: 'sms-new-message',
    kind: 'SMS',
    category: 'General',
    name: 'New Portal Message',
    body: '[Business Name]: you have a new message. Read it here: [Portal Message Link].',
  },

  // ----- Portal messages (3) -----
  {
    key: 'portal-welcome',
    kind: 'PORTAL_MESSAGE',
    category: 'Onboarding',
    name: 'Portal Welcome',
    body: html(
      hello,
      'This is your secure space with [Business Name]. Upload documents, sign and message us here.',
    ),
  },
  {
    key: 'portal-documents-received',
    kind: 'PORTAL_MESSAGE',
    category: 'Documents',
    name: 'Documents Received',
    body: html(
      hello,
      'We received your documents. We will let you know if anything else is needed.',
    ),
  },
  {
    key: 'portal-question',
    kind: 'PORTAL_MESSAGE',
    category: 'General',
    name: 'Question for You',
    body: html(
      hello,
      'I have a question about your file. When you have a moment, please reply here.',
    ),
  },

  // ----- Document requests (4) -----
  {
    key: 'docreq-tax-documents',
    kind: 'DOCUMENT_REQUEST',
    category: 'Tax Season',
    name: 'Tax Documents Request',
    body: html(
      hello,
      'Please upload your [Tax Year] tax documents: income forms, deduction records and last year’s return. Upload at [Document Upload Link].',
    ),
  },
  {
    key: 'docreq-bank-statements',
    kind: 'DOCUMENT_REQUEST',
    category: 'Bookkeeping',
    name: 'Bank Statements Request',
    body: html(
      hello,
      'Please upload your latest bank and card statements at [Document Upload Link].',
    ),
  },
  {
    key: 'docreq-id',
    kind: 'DOCUMENT_REQUEST',
    category: 'Onboarding',
    name: 'Identification Request',
    body: html(
      hello,
      'Please upload a photo of a government ID at [Document Upload Link] so we can verify your identity.',
    ),
  },
  {
    key: 'docreq-payroll-info',
    kind: 'DOCUMENT_REQUEST',
    category: 'Payroll',
    name: 'Payroll Information Request',
    body: html(
      hello,
      'Please upload your payroll reports for the period at [Document Upload Link].',
    ),
  },

  // ----- Intake organizer (2) -----
  {
    key: 'organizer-individual',
    kind: 'INTAKE_ORGANIZER',
    category: 'Tax Season',
    name: 'Individual Tax Organizer',
    body: html(
      hello,
      'Please complete your [Tax Year] organizer so we can prepare your return: [Organizer Link].',
    ),
  },
  {
    key: 'organizer-business',
    kind: 'INTAKE_ORGANIZER',
    category: 'Tax Season',
    name: 'Business Tax Organizer',
    body: html(hello, 'Please complete the [Tax Year] business organizer: [Organizer Link].'),
  },

  // ----- Engagement agreements (2) -----
  {
    key: 'agreement-tax',
    kind: 'ENGAGEMENT_AGREEMENT',
    category: 'Agreements',
    name: 'Tax Preparation Engagement',
    body: html(
      hello,
      '[Business Name] will prepare your [Tax Year] return. Please review and sign: [Signature Link].',
    ),
  },
  {
    key: 'agreement-bookkeeping',
    kind: 'ENGAGEMENT_AGREEMENT',
    category: 'Agreements',
    name: 'Bookkeeping Engagement',
    body: html(
      hello,
      '[Business Name] will keep your books. Please review and sign: [Signature Link].',
    ),
  },

  // ----- Invoices and payments (4) -----
  {
    key: 'invoice-new',
    kind: 'INVOICE_PAYMENT',
    category: 'Payments',
    name: 'New Invoice',
    body: html(
      hello,
      'Invoice [Invoice Number] dated [Invoice Date] is ready. Pay securely here: [Payment Link].',
    ),
  },
  {
    key: 'invoice-due-soon',
    kind: 'INVOICE_PAYMENT',
    category: 'Payments',
    name: 'Invoice Due Soon',
    body: html(hello, 'Invoice [Invoice Number] is due on [Due Date]. Pay here: [Payment Link].'),
  },
  {
    key: 'invoice-overdue',
    kind: 'INVOICE_PAYMENT',
    category: 'Payments',
    name: 'Invoice Overdue',
    body: html(
      hello,
      'Invoice [Invoice Number] was due on [Due Date]. Please pay it here: [Payment Link], or reply if you have questions.',
    ),
  },
  {
    key: 'invoice-receipt',
    kind: 'INVOICE_PAYMENT',
    category: 'Payments',
    name: 'Payment Received',
    body: html(hello, 'We received your payment for invoice [Invoice Number]. Thank you.'),
  },

  // ----- Appointments (4) -----
  {
    key: 'appt-confirmation',
    kind: 'APPOINTMENT',
    category: 'Appointments',
    name: 'Appointment Confirmation',
    body: html(
      hello,
      'Your [Appointment Type] is booked for [Appointment Date] at [Appointment Time]. Location: [Appointment Location/Link].',
    ),
  },
  {
    key: 'appt-reminder',
    kind: 'APPOINTMENT',
    category: 'Appointments',
    name: 'Appointment Reminder',
    body: html(
      hello,
      'A reminder of your [Appointment Type] on [Appointment Date] at [Appointment Time]. Need to change it? [Reschedule Link].',
    ),
  },
  {
    key: 'appt-reschedule',
    kind: 'APPOINTMENT',
    category: 'Appointments',
    name: 'Appointment Rescheduled',
    body: html(
      hello,
      'Your [Appointment Type] is now on [Appointment Date] at [Appointment Time].',
    ),
  },
  {
    key: 'appt-missed',
    kind: 'APPOINTMENT',
    category: 'Appointments',
    name: 'Missed Appointment',
    body: html(
      hello,
      'We missed you at your [Appointment Type]. You can pick a new time here: [Reschedule Link].',
    ),
  },

  // ----- Task checklists (3) -----
  {
    key: 'task-new-client',
    kind: 'TASK',
    category: 'Onboarding',
    name: 'New Client Setup Checklist',
    body: 'Create the client record\nSend the welcome message\nRequest identification\nSend the engagement agreement',
  },
  {
    key: 'task-return-review',
    kind: 'TASK',
    category: 'Tax Season',
    name: 'Return Review Checklist',
    body: 'Check income and deductions\nReview with the client\nCollect signatures\nE-file and confirm acceptance',
  },
  {
    key: 'task-month-end',
    kind: 'TASK',
    category: 'Bookkeeping',
    name: 'Month-End Close Checklist',
    body: 'Reconcile bank accounts\nReview uncategorized items\nSend the monthly report',
  },

  // ----- Tax workflow (3) -----
  {
    key: 'tax-organizer-sent',
    kind: 'TAX_WORKFLOW',
    category: 'Tax Season',
    name: 'Organizer Sent',
    body: html(hello, 'We sent your [Tax Year] organizer. Please complete it: [Organizer Link].'),
  },
  {
    key: 'tax-extension',
    kind: 'TAX_WORKFLOW',
    category: 'Tax Season',
    name: 'Extension Filed',
    body: html(
      hello,
      'We filed an extension for your [Tax Year] [Return Type] return. Please keep sending your documents: [Document Upload Link].',
    ),
  },
  {
    key: 'tax-filed',
    kind: 'TAX_WORKFLOW',
    category: 'Tax Season',
    name: 'Return Filed',
    body: html(
      hello,
      'Your [Tax Year] [Return Type] return was filed. Your copy is in your portal: [Client Portal Link].',
    ),
  },

  // ----- Bookkeeping (2) and Payroll (2) -----
  {
    key: 'books-monthly-report',
    kind: 'BOOKKEEPING',
    category: 'Bookkeeping',
    name: 'Monthly Report Ready',
    body: html(
      hello,
      'Your monthly financial report is ready in your portal: [Client Portal Link].',
    ),
  },
  {
    key: 'books-missing-receipts',
    kind: 'BOOKKEEPING',
    category: 'Bookkeeping',
    name: 'Missing Receipts',
    body: html(
      hello,
      'A few transactions need receipts. Please upload them at [Document Upload Link].',
    ),
  },
  {
    key: 'payroll-run-ready',
    kind: 'PAYROLL',
    category: 'Payroll',
    name: 'Payroll Ready to Approve',
    body: html(
      hello,
      'Your payroll is ready for approval. Please review it in your portal: [Client Portal Link].',
    ),
  },
  {
    key: 'payroll-filing-due',
    kind: 'PAYROLL',
    category: 'Payroll',
    name: 'Payroll Filing Due',
    body: html(
      hello,
      'A payroll filing is due soon. Please send us your latest reports: [Document Upload Link].',
    ),
  },

  // ----- Leads (2), campaign, letter, announcement -----
  {
    key: 'lead-first-contact',
    kind: 'LEAD_FOLLOW_UP',
    category: 'Leads',
    name: 'First Contact',
    body: html(
      hello,
      'Thank you for your interest in [Business Name]. I would be glad to talk about how we can help. You can book a time here: [Reschedule Link].',
    ),
  },
  {
    key: 'lead-second-touch',
    kind: 'LEAD_FOLLOW_UP',
    category: 'Leads',
    name: 'Second Follow-Up',
    body: html(
      hello,
      'I wanted to check in again after my last message. Please let me know if you would like to talk.',
    ),
  },
  {
    key: 'campaign-season-start',
    kind: 'CAMPAIGN',
    category: 'Campaigns',
    name: 'Tax Season Is Here',
    subject: 'Tax season is here',
    body:
      html(
        hello,
        '[Tax Year] tax season has started. Upload your documents early at [Document Upload Link] to get ahead.',
      ) + sign,
  },
  {
    key: 'letter-engagement-notice',
    kind: 'LETTER_NOTICE',
    category: 'Letters',
    name: 'Engagement Letter',
    subject: 'Engagement letter',
    body:
      html(
        '[Client Full Name]',
        'This letter confirms that [Business Name] will provide the services we discussed.',
        'Please sign and return it using the link we sent.',
      ) + sign,
  },
  {
    key: 'announce-new-service',
    kind: 'ANNOUNCEMENT',
    category: 'Announcements',
    name: 'New Service Announcement',
    subject: 'A new service from [Business Name]',
    body: html(hello, 'We are glad to announce a new service. Write to us to learn more.') + sign,
  },
];
