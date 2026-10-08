import { describe, expect, it } from 'vitest';
import { type Branding, FIRMIVRA_BRANDING } from '../../src/notify/branding.js';
import { type NotifyTemplate, TEMPLATE_CHANNEL } from '../../src/notify/notify.types.js';
import {
  NotifyTemplateError,
  type RenderedEmail,
  escapeHtml,
  render,
} from '../../src/notify/templates.js';
import { FIRM_NAME, SAMPLE_DATA } from './notify-fixtures.js';

const firm: Branding = {
  name: FIRM_NAME,
  primaryColor: '#1F3A6B',
  accentColor: '#C9A227',
  logoUrl: null,
  timeZone: 'America/New_York',
  isFirm: true,
};
const templates = Object.keys(TEMPLATE_CHANNEL) as NotifyTemplate[];
const brandingOf = (t: NotifyTemplate) =>
  t.startsWith('firm-application.') ? FIRMIVRA_BRANDING : firm;
const email = <T extends NotifyTemplate>(t: T, data = SAMPLE_DATA[t], options = {}) =>
  render(t, data, brandingOf(t), options) as RenderedEmail;

describe('templates', () => {
  it.each(templates)('%s renders synthetic data with no undefined and no raw markup', (t) => {
    const out = render(t, SAMPLE_DATA[t], brandingOf(t));
    expect(out.channel).toBe(TEMPLATE_CHANNEL[t]);
    const all = JSON.stringify(out);
    for (const bad of ['undefined', 'null', 'NaN', '[object Object]', 'Invalid Date']) {
      expect(all).not.toContain(bad);
    }
    if (out.channel === 'sms') {
      expect(out.text).toBe(`482913 is your ${FIRM_NAME} verification code. Never share it.`);
      return;
    }
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(out.text.length).toBeGreaterThan(40);
    // Every value is escaped in the HTML: names and messages never become markup.
    expect(out.html).not.toContain('<Tax>');
    expect(out.html).not.toContain('<b>your</b>');
    expect(out.html).not.toContain('"Co"');
  });

  it('puts the firm in client emails and Firmivra in platform emails', () => {
    const invoice = email('invoice.sent');
    expect(invoice.subject).toBe(`New invoice from ${FIRM_NAME}`);
    expect(invoice.html).toContain(escapeHtml(FIRM_NAME));
    expect(invoice.html).toContain('background:#1F3A6B');
    expect(invoice.text).toContain(`Sent by ${FIRM_NAME} through Firmivra.`);
    expect(invoice.text).toContain('notification settings');
    const app = email('firm-application.received');
    expect(app.html).toContain(`background:${FIRMIVRA_BRANDING.primaryColor}`);
    expect(app.text).toContain('Sent by Firmivra.');
    expect(app.text).not.toContain('notification settings');
  });

  it('escapes links, keeps the activation fragment and writes dates plainly', () => {
    const doc = email('document.requested');
    expect(doc.html).toContain('href="https://portal.example.test/sample/documents?a=1&amp;b=2"');
    expect(doc.text).toContain('Please upload it by November 1, 2026.');
    const invite = email('staff.invite');
    expect(invite.text).toContain('https://app.example.test/activate#token=synthetic-token');
    expect(invite.text).toContain('until Thursday, October 15, 2026 at 9:00 AM EDT');
    expect(email('appointment.booked').text).toContain(
      'When: Tuesday, October 20, 2026 at 9:30 AM CDT',
    );
  });

  it('q18: a declined client sign-up carries no reason; a declined firm application does', () => {
    const data = { ...SAMPLE_DATA['client.signup-declined'], reason: 'Synthetic private reason' };
    expect(JSON.stringify(email('client.signup-declined', data))).not.toContain('Synthetic');
    expect(email('firm-application.declined').text).toContain('> Not an accounting firm.');
  });

  it('asks for a reply only when the email has a Reply-To', () => {
    const plain = email('firm-application.info-requested');
    const reply = email('firm-application.info-requested', undefined, { canReply: true });
    expect(plain.text).not.toContain('Reply to this email');
    expect(reply.text).toContain('Reply to this email');
    expect(reply.html).toContain('&lt;b&gt;your&lt;/b&gt; license number.<br>Thanks.');
  });

  it('refuses data a template cannot use, naming the field only', () => {
    const bad = (t: NotifyTemplate, data: object) => () => render(t, data as never, firm);
    const invite = { ...SAMPLE_DATA['staff.invite'], link: 'javascript:alert(1)' };
    expect(bad('staff.invite', invite)).toThrow(NotifyTemplateError);
    const blank = { ...SAMPLE_DATA['invoice.sent'], firmName: ' ' };
    expect(bad('invoice.sent', blank)).toThrow('Template data needs firmName');
    const due = { ...SAMPLE_DATA['document.requested'], dueOn: '2026-02-30' };
    expect(bad('document.requested', due)).toThrow('dueOn');
    expect(bad('client.signup-email-code', { firmName: 'Sample', code: '12 34' })).toThrow(
      'Invalid code',
    );
    expect(bad('no.such' as NotifyTemplate, {})).toThrow('Unknown template');
  });

  it('falls back to safe colours and shows a logo only from https', () => {
    const odd = render('invoice.sent', SAMPLE_DATA['invoice.sent'], {
      ...firm,
      primaryColor: 'red;background:url(x)',
      logoUrl: 'http://cdn.example.test/logo.png',
    }) as RenderedEmail;
    expect(odd.html).not.toContain('url(x)');
    expect(odd.html).not.toContain('<img');
    const logo = render('invoice.sent', SAMPLE_DATA['invoice.sent'], {
      ...firm,
      logoUrl: 'https://cdn.example.test/logo.png?a=1&b=2',
    }) as RenderedEmail;
    expect(logo.html).toContain('<img src="https://cdn.example.test/logo.png?a=1&amp;b=2"');
  });
});
