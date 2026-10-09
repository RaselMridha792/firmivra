import { describe, expect, it } from 'vitest';
import { type Branding, FIRMIVRA_BRANDING } from '../../src/notify/branding.js';
import { type NotifyTemplate, TEMPLATE_CHANNEL } from '../../src/notify/notify.types.js';
import {
  NotifyTemplateError,
  type RenderOptions,
  type RenderedEmail,
  escapeHtml,
  render as renderWithout,
} from '../../src/notify/templates.js';
import { FIRM_NAME, LINK_ORIGINS, SAMPLE_DATA } from './notify-fixtures.js';

const firm: Branding = {
  name: FIRM_NAME,
  primaryColor: '#1F3A6B',
  accentColor: '#C9A227',
  logoUrl: null,
  timeZone: 'America/New_York',
  isFirm: true,
};
const templates = Object.keys(TEMPLATE_CHANNEL) as NotifyTemplate[];
/** render with the sites' origins, as SendingNotifyService passes them from config. */
const render: typeof renderWithout = (t, data, branding, options: RenderOptions = {}) =>
  renderWithout(t, data, branding, { linkOrigins: LINK_ORIGINS, ...options });
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
    expect(invoice.fromName).toBe(FIRM_NAME);
    const app = email('firm-application.received');
    expect(app.html).toContain(`background:${FIRMIVRA_BRANDING.primaryColor}`);
    expect(app.text).toContain('Sent by Firmivra.');
    // No "turn off emails like this" until preferences are read (step 5).
    for (const t of templates)
      expect(JSON.stringify(render(t, SAMPLE_DATA[t], brandingOf(t)))).not.toContain(
        'notification settings',
      );
  });

  it('names the firm the branding was loaded for, never a firm name from the data', () => {
    const data = { ...SAMPLE_DATA['invoice.sent'], firmName: 'Other Synthetic Firm' };
    const out = email('invoice.sent', data);
    expect(JSON.stringify(out)).not.toContain('Other Synthetic Firm');
    expect(out.subject).toBe(`New invoice from ${FIRM_NAME}`);
    const sms = render('client.signup-sms-code', { code: '482913', firmName: 'Other' }, firm);
    expect(sms).toMatchObject({ text: expect.stringContaining(FIRM_NAME) as string });
  });

  it("refuses a firm's template in Firmivra's branding and the other way round", () => {
    expect(() => render('invoice.sent', SAMPLE_DATA['invoice.sent'], FIRMIVRA_BRANDING)).toThrow(
      NotifyTemplateError,
    );
    const approved = SAMPLE_DATA['firm-application.approved'];
    expect(() => render('firm-application.approved', approved, firm)).toThrow(
      "Firmivra's own message",
    );
  });

  it('drops bidi and zero-width characters from the firm name everywhere it shows', () => {
    const spoof = { ...firm, name: 'Sample Tax \u202Emoc.elpmaxe\u200B' };
    const out = render('invoice.sent', SAMPLE_DATA['invoice.sent'], spoof) as RenderedEmail;
    expect(out.fromName).toBe('Sample Tax moc.elpmaxe');
    expect(JSON.stringify(out)).not.toMatch(/[\u202E\u200B]/);
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
    const blank = { ...SAMPLE_DATA['invoice.sent'], invoiceNumber: ' ' };
    expect(bad('invoice.sent', blank)).toThrow('Template data needs invoiceNumber');
    const due = { ...SAMPLE_DATA['document.requested'], dueOn: '2026-02-30' };
    expect(bad('document.requested', due)).toThrow('dueOn');
    expect(bad('client.signup-email-code', { code: '12 34' })).toThrow('Invalid code');
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

describe('firm-application.received', () => {
  it('is fixed text: nothing the applicant submitted can reach the unverified address', () => {
    const probe = {
      name: 'Your account is locked. Restore it at https://evil.example.test/restore',
      legalName: 'Probe <b>Corp</b> https://evil.example.test/',
      fullName: 'Probe Person',
      message: 'Probe message',
    };
    const plain = email('firm-application.received', {});
    const probed = email('firm-application.received', probe as never);
    // The same email whatever the data holds: no value of it is read.
    expect(probed).toEqual(plain);
    const all = JSON.stringify(probed);
    for (const value of ['evil', 'locked', 'Probe', 'Restore']) expect(all).not.toContain(value);
    expect(plain.text).toContain(
      "Thank you, we received your application. We review every application and we'll be in touch by email.",
    );
  });

  it('the later firm-application emails keep the names (a Super Admin has read the form)', () => {
    expect(email('firm-application.declined').text).toContain('Hi Jordan Sample,');
    expect(email('firm-application.approved').text).toContain('Sample Tax Partners LLC');
  });
});

describe('links', () => {
  const invite = (value: string, options: RenderOptions = {}) =>
    render('staff.invite', { ...SAMPLE_DATA['staff.invite'], link: value }, firm, options);
  const linkOf = (value: string) => {
    const out = invite(value) as RenderedEmail;
    return /Accept the invitation:\n(\S+)/.exec(out.text)?.[1];
  };

  it('accepts a link on each site, returned in its normalised form', () => {
    expect(linkOf('https://app.example.test/activate#token=synthetic-token')).toBe(
      'https://app.example.test/activate#token=synthetic-token',
    );
    expect(linkOf('https://portal.example.test/sample/sign-in')).toBe(
      'https://portal.example.test/sample/sign-in',
    );
    expect(linkOf('https://admin.example.test/applications')).toBe(
      'https://admin.example.test/applications',
    );
    expect(linkOf('https://APP.example.test:443/a/../activate')).toBe(
      'https://app.example.test/activate',
    );
  });

  it.each([
    ['a lookalike host (suffix)', 'https://app.example.test.evil.test/activate'],
    ['a lookalike host (dash)', 'https://app-example.test/activate'],
    ['a lookalike host (trailing dot)', 'https://app.example.test./activate'],
    ['the site in the path', 'https://evil.test/app.example.test/activate'],
    ['another port', 'https://app.example.test:8443/activate'],
    ['userinfo before another host', 'https://app.example.test@evil.test/activate'],
    ['userinfo on the site', 'https://good@app.example.test/activate'],
    ['a user and password on the site', 'https://user:secret@portal.example.test/sample'],
    ['http for an https site', 'http://app.example.test/activate'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['protocol-relative', '//app.example.test/activate'],
    ['a relative path', '/activate'],
    ['a leading NUL', '\u0000https://app.example.test/activate'],
    ['a leading control character', '\u001fhttps://app.example.test/activate'],
    ['a leading space', ' https://app.example.test/activate'],
    ['an embedded control character', 'https://app.example.test/act\u0007ivate'],
    ['an embedded tab', 'https://app.example.test/act\tivate'],
    ['an embedded line break', 'https://app.example.test/activate\r\nBcc: x'],
    ['an embedded bidi override', 'https://app.example.test/‮etavitca'],
    ['an embedded zero-width space', 'https://app.example.test/​activate'],
  ])('refuses %s', (_label, value) => {
    expect(() => invite(value)).toThrow(NotifyTemplateError);
    expect(() => invite(value)).toThrow('Template data needs link as a link to a Firmivra site');
  });

  it('refuses every link when no site origins are given', () => {
    const good = 'https://app.example.test/activate#token=synthetic-token';
    expect(() => invite(good, { linkOrigins: [] })).toThrow(NotifyTemplateError);
    expect(() => renderWithout('staff.invite', SAMPLE_DATA['staff.invite'], firm)).toThrow(
      'a link to a Firmivra site',
    );
  });

  it('takes http only when config gave an http site (development and test)', () => {
    const local = { linkOrigins: ['http://app.localhost:3000'] };
    const out = invite('http://app.localhost:3000/activate#token=t', local) as RenderedEmail;
    expect(out.text).toContain('http://app.localhost:3000/activate#token=t');
    expect(() => invite('https://app.localhost:3000/activate', local)).toThrow(NotifyTemplateError);
  });
});

describe('Begin Online and leads', () => {
  const probe = {
    name: 'Your account is locked. Restore it at https://evil.example.test/restore',
    firstName: 'Probe <b>Person</b>',
    email: 'probe@evil.example.test',
    message: 'Probe message',
  };

  it('the two visitor emails read nothing the visitor typed', () => {
    for (const t of ['begin-online.resume-link', 'lead.confirmation'] as const) {
      const plain = email(t);
      const probed = email(t, { ...SAMPLE_DATA[t], ...probe } as never);
      expect(probed).toEqual(plain);
      const all = JSON.stringify(probed);
      for (const value of ['evil', 'locked', 'Probe', 'Restore']) expect(all).not.toContain(value);
    }
  });

  it('the resume link keeps its #token= fragment', () => {
    const out = email('begin-online.resume-link');
    expect(out.html).toContain('/sample/begin/resume#token=synthetic-token');
    expect(out.text).toContain('/sample/begin/resume#token=synthetic-token');
  });

  it('escapes markup in a name and a service name', () => {
    const invite = email('client.portal-invite', {
      ...SAMPLE_DATA['client.portal-invite'],
      name: 'Robin <script>x</script>',
    });
    expect(invite.html).not.toContain('<script>');
    expect(invite.html).toContain('&lt;script&gt;');
    const received = email('lead.received', {
      ...SAMPLE_DATA['lead.received'],
      serviceName: 'Tax <img src=x>',
    });
    expect(received.html).not.toContain('<img src=x>');
    expect(received.html).toContain('&lt;img src=x&gt;');
  });
});

describe('message.received', () => {
  it('never carries the message text, only the name and the link', () => {
    const plain = email('message.received');
    const probed = email('message.received', {
      ...SAMPLE_DATA['message.received'],
      text: 'Secret probe body',
      body: 'Secret probe body',
    } as never);
    expect(probed).toEqual(plain);
    expect(JSON.stringify(probed)).not.toContain('Secret probe');
    expect(plain.subject).toBe(`New message in ${FIRM_NAME}'s portal`);
    expect(plain.text).toContain('https://portal.example.test/sample/messages');
  });
});
