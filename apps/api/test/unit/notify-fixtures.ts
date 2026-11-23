// Synthetic data for the NotifyService tests: one message per template, example.test only.
// No firm name in the data: a firm template names the firm its branding was loaded for.
import type { NotifyTemplate, NotifyTemplates } from '../../src/notify/notify.types.js';

export const FIRM_NAME = 'Sample & Sons <Tax> "Co"';
/** The app, portal and admin sites' origins, as config reads them from the *_BASE_URL settings. */
export const LINK_ORIGINS = [
  'https://app.example.test',
  'https://portal.example.test',
  'https://admin.example.test',
];
const link = 'https://portal.example.test/sample/documents?a=1&b=2';
const signLink = 'https://portal.example.test/sample/sign#t=synthetic-sign-token';
const workspaceLink = 'https://app.example.test/esign/requests/synthetic-id';
const appointment = {
  name: 'Robin Example',
  title: 'Tax review',
  startsAt: new Date('2026-10-20T14:30:00Z'),
  timeZone: 'America/Chicago',
  link,
};
/** P4-1: a lead's own appointment: no portal link. */
const { link: _portal, ...leadAppointment } = appointment;

export const SAMPLE_DATA: { [T in NotifyTemplate]: NotifyTemplates[T] } = {
  'staff.invite': {
    name: 'Sam Staff',
    link: 'https://app.example.test/activate#token=synthetic-token',
    expiresAt: new Date('2026-10-15T13:00:00Z'),
  },
  'client.signup-email-code': { code: '482913' },
  'staff.phone-code': { code: '482913' },
  'staff.mfa-reset': { name: 'Fake Member' },
  'platform.mfa-enrolled': { name: 'Fake Member' },
  'platform.firm-info-request': {
    name: 'Jordan Sample',
    firmName: 'Sample Tax Partners LLC',
    reference: '#1004',
    subject: 'Your business licence',
    message: 'Please send <b>your</b> current licence.\nThanks.',
    replyBy: '2026-12-01',
    link: 'https://app.example.test/settings/firmivra-requests/0199c0a0-0a00-7000-8000-000000000001',
  },
  'platform.firm-download-code': { code: '482913' },
  'platform.firm-download-link': {
    name: 'Jordan Sample',
    link: 'https://app.example.test/closed-firm-download#token=synthetic-download-token',
    expiresAt: new Date('2026-12-01T13:00:00Z'),
  },
  'client.signup-sms-code': { code: '482913' },
  'client.already-registered': {
    signInLink: 'https://portal.example.test/sample/sign-in',
  },
  'client.signup-approved': {
    name: 'Robin Example',
    signInLink: 'https://portal.example.test/sample/sign-in',
  },
  'client.signup-declined': { name: 'Robin Example' },
  'firm-application.received': {},
  'firm-application.info-requested': {
    name: 'Jordan Sample',
    legalName: 'Sample Tax Partners LLC',
    message: 'Please send <b>your</b> license number.\nThanks.',
    link: 'https://app.example.test/apply/respond#token=sample-token',
    expiresAt: new Date('2026-11-24T15:00:00Z'),
  },
  'firm-application.response-code': { name: 'Jordan Sample', code: '123456' },
  'firm-application.approved': {
    name: 'Jordan Sample',
    legalName: 'Sample Tax Partners LLC',
    link: 'https://app.example.test/activate#token=synthetic-token',
    expiresAt: new Date('2026-10-15T13:00:00Z'),
  },
  'firm-application.declined': {
    name: 'Jordan Sample',
    legalName: 'Sample Tax Partners LLC',
    reason: 'Not an accounting firm.',
  },
  'document.requested': {
    name: 'Robin Example',
    title: '2025 W-2',
    dueOn: '2026-11-01',
    link,
  },
  'document.requested-sms': { title: '2025 W-2', dueOn: '2026-11-01', link },
  'report.published': { name: 'Robin Example', title: 'Monthly bookkeeping', link },
  'announcement.published': { name: 'Robin Example', title: 'Extended office hours', link },
  'announcement.published-sms': { title: 'Extended office hours', link },
  'appointment.booked': appointment,
  'appointment.changed': appointment,
  'appointment.reminder': appointment,
  'appointment.reminder-sms': {
    title: 'Tax review',
    startsAt: new Date('2026-10-20T14:30:00Z'),
    timeZone: 'America/Chicago',
    link,
    message: 'Fake: bring your W-2.',
    instructions: null,
  },
  'appointment.lead-booked': leadAppointment,
  'appointment.lead-reminder': leadAppointment,
  'appointment.cancelled': {
    name: 'Robin Example',
    title: 'Tax review',
    startsAt: new Date('2026-10-20T14:30:00Z'),
    timeZone: 'America/Chicago',
    link,
    reason: 'The office is closed that day.',
  },
  'appointment.waitlist-offer': {
    name: 'Robin Example',
    offeredStartsAt: new Date('2026-10-18T14:30:00Z'),
    startsAt: new Date('2026-10-20T14:30:00Z'),
    expiresAt: new Date('2026-10-17T02:30:00Z'),
    timeZone: 'America/Chicago',
    link,
  },
  'task.reminder': {
    name: 'Fake Member',
    title: 'Fake task',
    dueOn: '2026-12-01',
    dueAt: new Date('2026-12-01T19:30:00Z'),
    timeZone: 'America/New_York',
    link: 'https://app.example.test/tasks/00000000-0000-4000-8000-000000000000',
  },
  'project-deadline.reminder': {
    name: 'Sam Staff',
    title: 'Finish the 2027 planning projections',
    dueAt: new Date('2026-12-01T22:00:00Z'),
    timeZone: 'America/Chicago',
    link: 'https://app.example.test/tax-planning/deadlines',
  },
  'invoice.sent': { name: 'Robin Example', invoiceNumber: 'INV-1042', link },
  'invoice.reminder': {
    name: 'Robin Example',
    invoiceNumber: 'INV-1042',
    dueOn: '2026-12-01',
    link,
  },
  'invoice.overdue': {
    name: 'Robin Example',
    invoiceNumber: 'INV-1042',
    dueOn: '2026-12-01',
    link,
  },
  'payment.received': { name: 'Robin Example', invoiceNumber: 'INV-1042', link },
  'esign.request': {
    name: 'Robin Example',
    senderName: 'Sam Staff',
    title: '2025 Form 8879',
    message: 'Please sign <b>your</b> return.\nThanks.',
    link: signLink,
  },
  'esign.code': { code: '482913', title: '2025 Form 8879' },
  'esign.reminder': { name: 'Robin Example', title: '2025 Form 8879', link: signLink },
  'esign.expiring': {
    name: 'Robin Example',
    title: '2025 Form 8879',
    expiresAt: new Date('2026-10-30T03:59:00Z'),
    link: signLink,
  },
  'esign.completed': {
    name: 'Robin Example',
    title: '2025 Form 8879',
    copyLink: 'https://portal.example.test/sample/sign#t=synthetic-copy-token',
  },
  'esign.declined': {
    name: 'Sam Staff',
    signerName: 'Robin Example',
    title: '2025 Form 8879',
    link: workspaceLink,
  },
  'esign.voided': { name: 'Robin Example', title: '2025 Form 8879' },
  'esign.approval-requested': {
    name: 'Alex Manager',
    senderName: 'Sam Staff',
    title: '2025 Form 8879',
    link: workspaceLink,
  },
  'esign.staff-update': {
    name: 'Sam Staff',
    title: '2025 Form 8879',
    event: 'SIGNED',
    signerName: 'Robin Example',
    link: workspaceLink,
  },
  'begin-online.resume-link': {
    link: 'https://portal.example.test/sample/begin/resume#token=synthetic-token',
    expiresAt: new Date('2026-10-30T13:00:00Z'),
  },
  'lead.confirmation': { serviceName: 'Annual Tax' },
  'lead.received': { serviceName: 'Annual Tax', link: 'https://app.example.test/leads/1' },
  'intake.submitted-notice': {
    formTitle: 'Personal Tax Intake Form',
    link: 'https://app.example.test/intake-forms',
  },
  'intake.received': { formTitle: 'Personal Tax Intake Form' },
  'intake.lead-link': {
    formTitle: 'Personal Tax Intake Form',
    link: 'https://portal.example.test/sample/form#token=synthetic-token',
    expiresAt: new Date('2026-11-30T23:59:59Z'),
    subject: 'Your intake form',
    message: 'Please fill this in.',
  },
  'intake.sent': {
    name: 'Robin Example',
    formTitle: 'Personal Tax Intake Form',
    link: 'https://portal.example.test/sample/intake/00000000-0000-4000-8000-000000000001',
    subject: 'Your intake form',
    message: 'Please fill this in.',
    dueOn: '2026-11-25',
    expiresAt: new Date('2026-11-30T23:59:59Z'),
  },
  'intake.reminder': {
    name: 'Robin Example',
    formTitle: 'Personal Tax Intake Form',
    link: 'https://portal.example.test/sample/intake/00000000-0000-4000-8000-000000000001',
    subject: 'Your intake form',
    message: 'Please fill this in.',
    dueOn: '2026-11-25',
    expiresAt: new Date('2026-11-30T23:59:59Z'),
  },
  'client.portal-invite': {
    name: 'Robin Example',
    signUpLink: 'https://portal.example.test/sample/sign-up',
  },
  'client.portal-invitation': {
    name: 'Robin Example',
    link: 'https://portal.example.test/sample/invitation#token=sample',
    expiresAt: new Date('2026-11-01T12:00:00Z'),
  },
  'message.received': {
    name: 'Robin Example',
    link: 'https://portal.example.test/sample/messages',
  },
  'lead.message-email': {
    name: 'Robin Example',
    subject: 'Welcome',
    body: 'Thanks for getting in touch.',
  },
  'lead.message-sms': { body: 'Thanks for getting in touch.' },
  'platform.message-email': {
    name: 'Jordan Sample',
    subject: 'Welcome to Firmivra',
    body: 'Your workspace is ready (sample).',
  },
  'platform.message-sms': { body: 'Your Firmivra workspace is ready (sample).' },
};
