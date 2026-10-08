// Synthetic data for the NotifyService tests: one message per template, example.test only.
import type { NotifyTemplate, NotifyTemplates } from '../../src/notify/notify.types.js';

export const FIRM_NAME = 'Sample & Sons <Tax> "Co"';
const firmName = FIRM_NAME;
const link = 'https://portal.example.test/sample/documents?a=1&b=2';
const appointment = {
  name: 'Robin Example',
  firmName,
  title: 'Tax review',
  startsAt: new Date('2026-10-20T14:30:00Z'),
  timeZone: 'America/Chicago',
  link,
};

export const SAMPLE_DATA: { [T in NotifyTemplate]: NotifyTemplates[T] } = {
  'staff.invite': {
    name: 'Sam Staff',
    firmName,
    link: 'https://app.example.test/activate#token=synthetic-token',
    expiresAt: new Date('2026-10-15T13:00:00Z'),
  },
  'client.signup-email-code': { firmName, code: '482913' },
  'client.signup-sms-code': { firmName, code: '482913' },
  'client.already-registered': {
    firmName,
    signInLink: 'https://portal.example.test/sample/sign-in',
  },
  'client.signup-approved': {
    name: 'Robin Example',
    firmName,
    signInLink: 'https://portal.example.test/sample/sign-in',
  },
  'client.signup-declined': { name: 'Robin Example', firmName },
  'firm-application.received': { name: 'Jordan Sample', legalName: 'Sample Tax Partners LLC' },
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
    firmName,
    title: '2025 W-2',
    dueOn: '2026-11-01',
    link,
  },
  'appointment.booked': appointment,
  'appointment.changed': appointment,
  'appointment.reminder': appointment,
  'invoice.sent': { name: 'Robin Example', firmName, invoiceNumber: 'INV-1042', link },
  'payment.received': { name: 'Robin Example', firmName, invoiceNumber: 'INV-1042', link },
};
