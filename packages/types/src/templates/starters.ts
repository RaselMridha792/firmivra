import type { MessageTemplateKind } from '../db-enums.js';

// The 48 starter templates every firm installs (idempotent, by `key`): the developer guide's
// section 8 list, name by name, in its categories (TP-F18). One source for the API's install and
// the web mock. Plain wording with merge fields; a firm edits them freely after they are
// installed. SMS and task checklists are plain text, the rest simple HTML. No year, date, person,
// price, number or link is written in: merge fields and the firm's Settings supply them, and
// anything confidential points to the secure portal. A key kept from the earlier list is the same
// template, so a firm that installed it does not get it twice.

export interface StarterTemplate {
  /** Stable, unique in the list: it is the template's starterKey. */
  key: string;
  kind: MessageTemplateKind;
  /** The firm category it is placed in (made when missing). */
  category: string;
  name: string;
  /** What it is for (the guide's purpose), shown in the editor. */
  description: string;
  subject?: string;
  body: string;
}

const html = (...paragraphs: string[]) => paragraphs.map((p) => `<p>${p}</p>`).join('');
const sign = '<p>Thank you,<br>[Staff Name]<br>[Business Name]<br>[Company Phone]</p>';
const hello = 'Hello [Client First Name],';
const review = ' A starting point: review and edit it for your firm before you use it.';

const CLIENT = 'Email / Client Communication';
const TAX = 'Tax Season';
const APPOINTMENTS = 'Appointments';
const INVOICES = 'Invoices & Payments';
const BOOKS = 'Bookkeeping';
const PAYROLL = 'Payroll';
const LEADS = 'Leads';
const ENGAGEMENT = 'Engagement / Documents';
const NOTICES = 'Portal / Notices';
const MARKETING = 'Marketing / Campaign';
const INTERNAL = 'Internal / Workflow';

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  // ----- Email / Client Communication (6) -----
  {
    key: 'email-welcome',
    kind: 'EMAIL',
    category: CLIENT,
    name: 'New Client Welcome Email',
    description: 'Welcome, portal access, next steps and contact information.',
    subject: 'Welcome to [Business Name]',
    body:
      html(
        hello,
        'Welcome to [Business Name]. We are glad you chose us and look forward to working with you.',
        'Your secure client portal is at [Client Portal Link]. Use it to upload documents, sign and message us; please do not send sensitive information by email.',
        'Next, we will send what we need from you to get started. You can reach us at [Company Phone] or [Company Email].',
      ) + sign,
  },
  {
    key: 'email-welcome-back',
    kind: 'EMAIL',
    category: CLIENT,
    name: 'Existing Client Welcome Back',
    description: 'Welcome returning client and summarize next steps.',
    subject: 'Welcome back to [Business Name]',
    body:
      html(
        hello,
        'Welcome back. It is good to be working with you again.',
        'Here is what comes next: we will confirm your services, send anything we need through your portal at [Client Portal Link], and let you know when your work is under way.',
      ) + sign,
  },
  {
    key: 'email-missing-info',
    kind: 'EMAIL',
    category: CLIENT,
    name: 'Missing Documents Follow-Up',
    description: 'List outstanding documents and secure upload CTA.',
    subject: 'A few documents are still needed',
    body:
      html(
        hello,
        'We are still missing a few documents to finish your work. You can see the list and upload them securely here: [Document Upload Link].',
        'If anything does not apply to you, reply and let us know.',
      ) + sign,
  },
  {
    key: 'email-documents-received',
    kind: 'EMAIL',
    category: CLIENT,
    name: 'Document Received Confirmation',
    description: 'Confirm receipt and explain review timeline.',
    subject: 'We received your documents',
    body:
      html(
        hello,
        'Thank you, we received your documents. We will review them and let you know through your portal if anything else is needed.',
      ) + sign,
  },
  {
    key: 'email-follow-up',
    kind: 'EMAIL',
    category: CLIENT,
    name: 'General Client Follow-Up',
    description: 'Professional reusable follow-up after a conversation or request.',
    subject: 'Following up from [Business Name]',
    body:
      html(
        hello,
        'Thank you for your time. I am following up on our recent conversation.',
        'Please let me know if you have any questions or if there is anything else we can help with.',
      ) + sign,
  },
  {
    key: 'email-portal-invitation',
    kind: 'EMAIL',
    category: CLIENT,
    name: 'Client Portal Invitation',
    description: 'Portal activation/login instructions and security reminder.',
    subject: 'Your secure client portal with [Business Name]',
    body:
      html(
        hello,
        '[Business Name] uses a secure client portal to share documents and messages. Set up your login here: [Client Portal Link].',
        'For your security, choose a password only you know, and never share it. We will never ask for your password by email or phone.',
      ) + sign,
  },

  // ----- Tax Season (9) -----
  {
    key: 'email-tax-season-open',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Season Opening Announcement',
    description: 'Notify clients that tax-season appointments/intake are open.',
    subject: '[Tax Year] tax season is open at [Business Name]',
    body:
      html(
        hello,
        'Tax season is here, and we are now taking appointments and documents for your [Tax Year] return.',
        'Book a time or start your organizer in your portal: [Client Portal Link].',
      ) + sign,
  },
  {
    key: 'email-organizer-ready',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Organizer Ready',
    description: 'Organizer is available; link to complete/upload.',
    subject: 'Your [Tax Year] tax organizer is ready',
    body:
      html(
        hello,
        'Your [Tax Year] tax organizer is ready. Complete it and upload your documents here: [Organizer Link].',
      ) + sign,
  },
  {
    key: 'email-tax-appointment-prep',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Appointment Preparation',
    description: 'What to bring/complete before tax appointment.',
    subject: 'Getting ready for your tax appointment',
    body:
      html(
        hello,
        'Your appointment is on [Appointment Date] at [Appointment Time]. To make the most of it, please complete your organizer and upload your income and deduction documents beforehand at [Document Upload Link].',
      ) + sign,
  },
  {
    key: 'email-tax-docs-needed',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Documents Still Needed',
    description: 'Specific missing-tax-document reminder.',
    subject: 'Documents still needed for your [Tax Year] return',
    body:
      html(
        hello,
        'We need a few more documents to finish your [Tax Year] [Return Type] return. The list is in your portal; please upload them at [Document Upload Link].',
      ) + sign,
  },
  {
    key: 'email-return-ready',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Return Ready for Review',
    description: 'Return is ready; review/approval next steps.',
    subject: 'Your [Tax Year] tax return is ready for review',
    body:
      html(
        hello,
        'Your [Tax Year] tax return is ready. Please review it securely in your portal at [Client Portal Link] and let us know if you have questions.',
        'Once you approve it, we will send it for your signature.',
      ) + sign,
  },
  {
    key: 'email-signature-request',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Return Signature Request',
    description: 'Request e-signature with secure link.',
    subject: 'Please sign your [Tax Year] tax return',
    body:
      html(
        hello,
        'Your [Tax Year] tax return is ready to sign. Please sign it securely here: [Signature Link].',
        'We file it as soon as we receive your signature.',
      ) + sign,
  },
  {
    key: 'email-return-filed',
    kind: 'EMAIL',
    category: TAX,
    name: 'Tax Return Filed Confirmation',
    description: 'Confirm filing and explain recordkeeping/refund/payment next steps.',
    subject: 'Your [Tax Year] tax return has been filed',
    body:
      html(
        hello,
        'Good news: your [Tax Year] tax return has been filed. Your filed copy is in your portal at [Client Portal Link]; please keep it with your records.',
        'Any refund or payment details are in your portal as well. Let us know if you have questions.',
      ) + sign,
  },
  {
    key: 'email-extension-filed',
    kind: 'EMAIL',
    category: TAX,
    name: 'Extension Filed Confirmation',
    description: 'Confirm extension and explain payment/document obligations.',
    subject: 'Your [Tax Year] extension has been filed',
    body:
      html(
        hello,
        'We filed an extension for your [Tax Year] return. An extension gives more time to file, not more time to pay: any tax owed is still due by the original deadline.',
        'Please keep sending your remaining documents through [Document Upload Link].',
      ) + sign,
  },
  {
    key: 'email-estimated-tax',
    kind: 'EMAIL',
    category: TAX,
    name: 'Estimated Tax Payment Reminder',
    description: 'Quarterly estimated-tax reminder with due date/payment guidance.',
    subject: 'Estimated tax payment due [Due Date]',
    body:
      html(
        hello,
        'Your next estimated tax payment is due on [Due Date]. Your payment details are in your portal at [Client Portal Link].',
        'If your income has changed, let us know before you pay so we can adjust the amount.',
      ) + sign,
  },

  // ----- Appointments (6) -----
  {
    key: 'appt-confirmation',
    kind: 'APPOINTMENT',
    category: APPOINTMENTS,
    name: 'Appointment Confirmation',
    description: 'Date/time/type/location or meeting link.',
    body: html(
      hello,
      'Your [Appointment Type] is confirmed for [Appointment Date] at [Appointment Time]. Where: [Appointment Location/Link].',
      'Need a different time? Use [Reschedule Link].',
    ),
  },
  {
    key: 'appt-reminder',
    kind: 'APPOINTMENT',
    category: APPOINTMENTS,
    name: 'Appointment Reminder — 24 Hours',
    description: 'Reminder with preparation instructions.',
    body: html(
      hello,
      'A reminder of your [Appointment Type] tomorrow, [Appointment Date] at [Appointment Time]. Where: [Appointment Location/Link].',
      'Please have any documents we asked for ready, or upload them first at [Document Upload Link].',
    ),
  },
  {
    key: 'appt-reminder-hour',
    kind: 'APPOINTMENT',
    category: APPOINTMENTS,
    name: 'Appointment Reminder — 1 Hour',
    description: 'Short final reminder.',
    body: html(
      hello,
      'See you soon: your [Appointment Type] starts at [Appointment Time]. Where: [Appointment Location/Link].',
    ),
  },
  {
    key: 'appt-reschedule',
    kind: 'APPOINTMENT',
    category: APPOINTMENTS,
    name: 'Appointment Rescheduled',
    description: 'Confirm revised date/time.',
    body: html(
      hello,
      'Your [Appointment Type] has moved to [Appointment Date] at [Appointment Time]. Where: [Appointment Location/Link].',
    ),
  },
  {
    key: 'appt-missed',
    kind: 'APPOINTMENT',
    category: APPOINTMENTS,
    name: 'Missed Appointment / No-Show Follow-Up',
    description: 'Invite client to reschedule.',
    body: html(
      hello,
      'We missed you at your [Appointment Type] on [Appointment Date]. Please choose a new time here: [Reschedule Link].',
    ),
  },
  {
    key: 'appt-follow-up',
    kind: 'APPOINTMENT',
    category: APPOINTMENTS,
    name: 'Post-Appointment Follow-Up',
    description: 'Recap next steps and requested items.',
    body: html(
      hello,
      'Thank you for meeting with us. The next steps and anything we still need from you are in your portal at [Client Portal Link].',
    ),
  },

  // ----- Invoices & Payments (5) -----
  {
    key: 'invoice-new',
    kind: 'INVOICE_PAYMENT',
    category: INVOICES,
    name: 'Invoice Issued',
    description: 'Invoice number, amount, due date and payment link.',
    body: html(
      hello,
      'Invoice [Invoice Number] for [Balance Due] is ready, due on [Due Date]. Pay securely here: [Payment Link].',
    ),
  },
  {
    key: 'invoice-due-soon',
    kind: 'INVOICE_PAYMENT',
    category: INVOICES,
    name: 'Payment Due Soon',
    description: 'Friendly upcoming due-date reminder.',
    body: html(
      hello,
      'A friendly reminder that invoice [Invoice Number] for [Balance Due] is due on [Due Date]. Pay here: [Payment Link].',
    ),
  },
  {
    key: 'invoice-overdue',
    kind: 'INVOICE_PAYMENT',
    category: INVOICES,
    name: 'Payment Overdue — First Notice',
    description: 'Professional first overdue reminder.',
    body: html(
      hello,
      'Invoice [Invoice Number] for [Balance Due] was due on [Due Date] and is now past due. Please pay it here: [Payment Link], or reply if you have a question about it.',
    ),
  },
  {
    key: 'invoice-final-reminder',
    kind: 'INVOICE_PAYMENT',
    category: INVOICES,
    name: 'Payment Overdue — Final Reminder',
    description: 'Stronger final reminder before internal escalation.',
    body: html(
      hello,
      'Invoice [Invoice Number] for [Balance Due] is still unpaid since [Due Date]. Please pay it now at [Payment Link], or contact us at [Company Phone] to arrange payment, so we can avoid further steps.',
    ),
  },
  {
    key: 'invoice-receipt',
    kind: 'INVOICE_PAYMENT',
    category: INVOICES,
    name: 'Payment Received / Receipt',
    description: 'Confirm payment and thank client.',
    body: html(
      hello,
      'Thank you, we received your payment for invoice [Invoice Number]. Your receipt is in your portal at [Client Portal Link].',
    ),
  },

  // ----- Bookkeeping (5) -----
  {
    key: 'books-monthly-request',
    kind: 'BOOKKEEPING',
    category: BOOKS,
    name: 'Monthly Bookkeeping Document Request',
    description: 'Request monthly bank/card/payroll/source documents.',
    body: html(
      hello,
      'It is time for this month’s bookkeeping. Please upload your bank and card statements, payroll reports and receipts at [Document Upload Link].',
    ),
  },
  {
    key: 'books-missing-receipts',
    kind: 'BOOKKEEPING',
    category: BOOKS,
    name: 'Bookkeeping Records Missing',
    description: 'Follow-up for missing monthly records.',
    body: html(
      hello,
      'We are still missing some records to finish this month’s books. The list is in your portal; please upload them at [Document Upload Link].',
    ),
  },
  {
    key: 'books-monthly-report',
    kind: 'BOOKKEEPING',
    category: BOOKS,
    name: 'Monthly Books Completed',
    description: 'Notify client books are updated/review-ready.',
    body: html(
      hello,
      'Your books for the month are up to date. Your reports are ready to review in your portal at [Client Portal Link].',
    ),
  },
  {
    key: 'books-quarterly-review',
    kind: 'BOOKKEEPING',
    category: BOOKS,
    name: 'Quarterly Bookkeeping Review',
    description: 'Quarterly review/update and next-step message.',
    body: html(
      hello,
      'Your quarterly bookkeeping review is ready in your portal at [Client Portal Link]. Let us know if you would like to go over it together.',
    ),
  },
  {
    key: 'books-year-end',
    kind: 'BOOKKEEPING',
    category: BOOKS,
    name: 'Year-End Bookkeeping Checklist',
    description: 'Year-end close/document checklist.',
    body: html(
      hello,
      'To close the year, please upload your final statements, loan and asset records, and any remaining receipts at [Document Upload Link]. The full checklist is in your portal.',
    ),
  },

  // ----- Payroll (3) -----
  {
    key: 'payroll-info-reminder',
    kind: 'PAYROLL',
    category: PAYROLL,
    name: 'Payroll Information Reminder',
    description: 'Request hours/changes before payroll cutoff.',
    body: html(
      hello,
      'Please send this period’s hours and any changes (new hires, pay changes, departures) before the payroll cutoff on [Due Date], through [Document Upload Link].',
    ),
  },
  {
    key: 'payroll-completed',
    kind: 'PAYROLL',
    category: PAYROLL,
    name: 'Payroll Completed Notification',
    description: 'Confirm payroll processing and availability of reports.',
    body: html(
      hello,
      'Payroll for this period has been processed. Your payroll reports are in your portal at [Client Portal Link].',
    ),
  },
  {
    key: 'payroll-employee-info',
    kind: 'PAYROLL',
    category: PAYROLL,
    name: 'Payroll Document / Employee Info Request',
    description: 'Request missing employee/payroll documentation.',
    body: html(
      hello,
      'We need a few employee or payroll documents to keep payroll on track. The list is in your portal; please upload them securely at [Document Upload Link].',
    ),
  },

  // ----- Leads (4) -----
  {
    key: 'lead-first-contact',
    kind: 'LEAD_FOLLOW_UP',
    category: LEADS,
    name: 'New Lead First Response',
    description: 'Acknowledge inquiry and provide next step/booking CTA.',
    body: html(
      hello,
      'Thank you for contacting [Business Name]. We would be glad to help. The next step is a short consultation; reply with a good time, or call us at [Company Phone].',
    ),
  },
  {
    key: 'lead-second-touch',
    kind: 'LEAD_FOLLOW_UP',
    category: LEADS,
    name: 'Lead Follow-Up — No Response',
    description: 'Follow up after no reply.',
    body: html(
      hello,
      'I wanted to follow up on your inquiry with [Business Name]. Are you still looking for help? Reply here or call [Company Phone] whenever suits you.',
    ),
  },
  {
    key: 'lead-consultation-reminder',
    kind: 'LEAD_FOLLOW_UP',
    category: LEADS,
    name: 'Consultation Reminder',
    description: 'Reminder for lead consultation.',
    body: html(
      hello,
      'A reminder of your consultation with [Business Name] on [Appointment Date] at [Appointment Time]. Where: [Appointment Location/Link].',
    ),
  },
  {
    key: 'lead-post-consultation',
    kind: 'LEAD_FOLLOW_UP',
    category: LEADS,
    name: 'Post-Consultation Follow-Up',
    description: 'Summarize services/next step after consultation.',
    body: html(
      hello,
      'Thank you for meeting with us. As discussed, we can help with [Service Name]. When you are ready, reply and we will send the next step to get started.',
    ),
  },

  // ----- Engagement / Documents (4) -----
  {
    key: 'agreement-sent',
    kind: 'ENGAGEMENT_AGREEMENT',
    category: ENGAGEMENT,
    name: 'Engagement Agreement Sent',
    description: `Notify client agreement is ready for review/signature.${review}`,
    body: html(
      hello,
      'Your engagement agreement for [Service Name] is ready. Please review and sign it securely here: [Signature Link].',
    ),
  },
  {
    key: 'agreement-reminder',
    kind: 'ENGAGEMENT_AGREEMENT',
    category: ENGAGEMENT,
    name: 'Engagement Agreement Reminder',
    description: `Reminder for unsigned agreement.${review}`,
    body: html(
      hello,
      'A reminder that your engagement agreement for [Service Name] is waiting for your signature: [Signature Link]. We can begin as soon as it is signed.',
    ),
  },
  {
    key: 'email-document-signature',
    kind: 'EMAIL',
    category: ENGAGEMENT,
    name: 'Document Signature Request',
    description: 'Generic e-signature request.',
    subject: 'A document from [Business Name] is ready to sign',
    body:
      html(
        hello,
        'A document is ready for your signature. Please review and sign it securely here: [Signature Link].',
      ) + sign,
  },
  {
    key: 'docreq-secure-upload',
    kind: 'DOCUMENT_REQUEST',
    category: ENGAGEMENT,
    name: 'Secure Document Upload Request',
    description: 'Request document upload through secure portal.',
    body: html(
      hello,
      'Please upload the requested documents through your secure portal: [Document Upload Link]. Do not send them by email.',
    ),
  },

  // ----- Portal / Notices (2) -----
  {
    key: 'portal-new-message',
    kind: 'PORTAL_MESSAGE',
    category: NOTICES,
    name: 'New Portal Message Notification',
    description: 'Notify client of a new secure portal message without exposing sensitive content.',
    body: html(
      hello,
      'You have a new secure message from [Business Name]. Read it in your portal: [Portal Message Link].',
    ),
  },
  {
    key: 'letter-important-notice',
    kind: 'LETTER_NOTICE',
    category: NOTICES,
    name: 'Important Client Notice',
    description: `Generic branded notice template for time-sensitive client information.${review}`,
    subject: 'Important notice from [Business Name]',
    body:
      html(
        hello,
        'We are writing to let you know about an important, time-sensitive matter. The details are in your secure portal at [Client Portal Link].',
        'Please contact us at [Company Phone] or [Company Email] with any questions.',
      ) + sign,
  },

  // ----- Marketing / Campaign (3) -----
  {
    key: 'campaign-newsletter',
    kind: 'CAMPAIGN',
    category: MARKETING,
    name: 'Monthly Tax & Business Newsletter',
    description: 'Reusable educational newsletter shell.',
    subject: 'News and tips from [Business Name]',
    body:
      html(
        hello,
        'Here is this month’s news from [Business Name]: what is changing, what to plan for, and a tip to save you time.',
        'This month: (add your topics here).',
        'Questions? Reply or visit [Company Website].',
      ) + sign,
  },
  {
    key: 'campaign-tax-deadline',
    kind: 'CAMPAIGN',
    category: MARKETING,
    name: 'Tax Deadline Reminder Campaign',
    description: 'Deadline awareness campaign with CTA.',
    subject: 'A tax deadline is coming up on [Due Date]',
    body:
      html(
        hello,
        'A reminder that an important tax deadline is coming up on [Due Date]. If we can help you meet it, book a time or send your documents through [Client Portal Link].',
      ) + sign,
  },
  {
    key: 'campaign-new-service',
    kind: 'CAMPAIGN',
    category: MARKETING,
    name: 'Service Announcement / New Service',
    description: 'Introduce a service or service update.',
    subject: 'Something new at [Business Name]',
    body:
      html(
        hello,
        'We are pleased to announce [Service Name] at [Business Name]. Reply or visit [Company Website] to learn how it can help you.',
      ) + sign,
  },

  // ----- Internal / Workflow (1) -----
  {
    key: 'task-client-follow-up',
    kind: 'TASK',
    category: INTERNAL,
    name: 'Standard Client Follow-Up Task Checklist',
    description: 'Reusable internal checklist for staff follow-up, documentation and completion.',
    body: 'Review the client’s request and file\nContact the client and note the outcome\nRequest any missing documents\nRecord what was done and attach documents\nSet the next follow-up date or close the task',
  },
];
