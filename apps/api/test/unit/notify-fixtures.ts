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

export const SAMPLE_DATA: { [T in NotifyTemplate]: NotifyTemplates[T] } = {
  'staff.invite': {
    name: 'Sam Staff',
    link: 'https://app.example.test/activate#token=synthetic-token',
    expiresAt: new Date('2026-10-15T13:00:00Z'),
  },
  'client.signup-email-code': { code: '482913' },
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
  },
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
  'appointment.booked': appointment,
  'appointment.changed': appointment,
  'appointment.reminder': appointment,
  'invoice.sent': { name: 'Robin Example', invoiceNumber: 'INV-1042', link },
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
  'client.portal-invite': {
    name: 'Robin Example',
    signUpLink: 'https://portal.example.test/sample/sign-up',
  },
  'message.received': {
    name: 'Robin Example',
    link: 'https://portal.example.test/sample/messages',
  },
};
