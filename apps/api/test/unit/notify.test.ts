import type { SESv2Client } from '@aws-sdk/client-sesv2';
import type { SNSClient } from '@aws-sdk/client-sns';
import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { BrandingSource, FIRMIVRA_BRANDING, UnknownFirmError } from '../../src/notify/branding.js';
import { loadNotifyConfig, parseSender } from '../../src/notify/config.js';
import { NotifyDeliveryError, SendingNotifyService } from '../../src/notify/notify.service.js';
import {
  ALWAYS_SENT,
  type NotifyMessage,
  TEMPLATE_CATEGORY,
  TEMPLATE_CHANNEL,
  TEMPLATE_SENDER,
} from '../../src/notify/notify.types.js';
import { NotifyTemplateError } from '../../src/notify/templates.js';
import {
  MAX_SENDER_NAME,
  type MailTransporter,
  type OutgoingEmail,
  SesEmailTransport,
  SmtpEmailTransport,
  SnsSmsTransport,
  formatSender,
  senderDisplayName,
} from '../../src/notify/transports.js';
import { FIRM_NAME, LINK_ORIGINS, SAMPLE_DATA } from './notify-fixtures.js';

const FIRM_ID = '00000000-0000-4000-8000-000000000001';
const TO = 'robin@example.test';
const PHONE = '+17705550199';
const invoice: NotifyMessage<'invoice.sent'> = {
  template: 'invoice.sent',
  to: TO,
  businessId: FIRM_ID,
  data: SAMPLE_DATA['invoice.sent'],
};
const smsCode: NotifyMessage<'client.signup-sms-code'> = {
  template: 'client.signup-sms-code',
  to: PHONE,
  businessId: FIRM_ID,
  data: SAMPLE_DATA['client.signup-sms-code'],
};
const declined: NotifyMessage<'firm-application.declined'> = {
  template: 'firm-application.declined',
  to: 'jordan@example.test',
  businessId: null,
  data: SAMPLE_DATA['firm-application.declined'],
};
const FROM = { name: 'Firmivra', address: 'no-reply@dev.example.test' };
const firmBranding = { ...FIRMIVRA_BRANDING, name: FIRM_NAME, isFirm: true };
/** What must never reach a log line or an error: addresses, numbers, codes, names, text. */
const PRIVATE = [TO, 'jordan@', '5550199', '482913', 'Robin', 'Jordan', 'INV-1042', 'Not an'];

function setup(opts: { email?: boolean; sms?: boolean; fail?: Error } = {}) {
  const logger = { log: vi.fn(), warn: vi.fn() };
  const mails: OutgoingEmail[] = [];
  const texts: { to: string; text: string }[] = [];
  const maybeFail = () => (opts.fail ? Promise.reject(opts.fail) : Promise.resolve());
  const notify = new SendingNotifyService({
    preferences: { allows: () => Promise.resolve(true) },
    branding: { load: (id) => Promise.resolve(id ? firmBranding : FIRMIVRA_BRANDING) },
    email:
      opts.email === false
        ? null
        : { from: FROM, transport: { send: (m) => (mails.push(m), maybeFail()) } },
    sms: opts.sms ? { send: (s) => (texts.push(s), maybeFail()) } : null,
    linkOrigins: LINK_ORIGINS,
    logger,
  });
  const logged = () => JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
  return { notify, logger, mails, texts, logged };
}

describe('SendingNotifyService', () => {
  it('sends a client email from the firm and a platform email from Firmivra', async () => {
    const { notify, mails, logged } = setup();
    await notify.send(invoice);
    await notify.send({ ...declined, replyTo: 'support@example.test' });
    expect(mails[0]).toMatchObject({ from: { name: FIRM_NAME }, to: TO, replyTo: null });
    expect(mails[0]!.subject).toBe(`New invoice from ${FIRM_NAME}`);
    expect(mails[1]).toMatchObject({ from: FROM, replyTo: 'support@example.test' });
    expect(logged()).toContain(`email \\"invoice.sent\\" (firm ${FIRM_ID}) sent`);
  });

  it('sends texts through the SMS transport, or only logs them while none is registered', async () => {
    const sns = setup({ sms: true });
    await sns.notify.send(smsCode);
    expect(sns.texts).toEqual([{ to: PHONE, text: expect.stringContaining('482913') as string }]);
    const unregistered = setup();
    await expect(unregistered.notify.send(smsCode)).resolves.toBeUndefined();
    expect(unregistered.logged()).toContain('written to the log only');
  });

  it('with EMAIL_MODE=log sends nothing and logs the template only', async () => {
    const { notify, logged } = setup({ email: false });
    await notify.send(invoice);
    expect(logged()).toContain('EMAIL_MODE=log');
  });

  it('never logs a recipient, a code, a name or a body (hard rule 4)', async () => {
    for (const s of [setup({ sms: true }), setup({ email: false }), setup()]) {
      await s.notify.send(invoice);
      await s.notify.send(declined);
      await s.notify.send(smsCode);
      for (const value of PRIVATE) expect(s.logged()).not.toContain(value);
    }
  });

  it('rejects a provider failure with the error name only, never the address', async () => {
    const fail = Object.assign(new Error(`Email address is not verified: ${TO}`), {
      name: 'MessageRejected',
    });
    const s = setup({ sms: true, fail });
    const error = await s.notify.send(invoice).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotifyDeliveryError);
    expect(error).toMatchObject({ template: 'invoice.sent', reason: 'MessageRejected' });
    expect((error as Error).cause).toBeUndefined();
    const smsError = await s.notify.send(smsCode).catch((e: unknown) => e);
    expect(smsError).toBeInstanceOf(NotifyDeliveryError);
    const seen = JSON.stringify([error, smsError, String(error), String(smsError)]) + s.logged();
    for (const value of PRIVATE) expect(seen).not.toContain(value);
    expect(s.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not sent: MessageRejected'),
    );
  });

  it('refuses an address that cannot be one, an unknown template or a bad Reply-To', async () => {
    const { notify, mails } = setup();
    await expect(notify.send({ ...invoice, to: PHONE })).rejects.toThrow(NotifyDeliveryError);
    await expect(notify.send({ ...smsCode, to: TO })).rejects.toThrow('InvalidRecipient');
    const bad = { ...invoice, template: 'no.such' } as unknown as NotifyMessage;
    await expect(notify.send(bad)).rejects.toThrow('Unknown template');
    await expect(notify.send({ ...invoice, replyTo: 'nope' })).rejects.toThrow('replyTo');
    expect(mails).toHaveLength(0);
  });

  it("refuses a firm's template without its firm and Firmivra's own with a firm", async () => {
    const { notify, mails, logger } = setup();
    await expect(notify.send({ ...invoice, businessId: null })).rejects.toThrow(
      'needs the businessId',
    );
    await expect(notify.send({ ...declined, businessId: FIRM_ID })).rejects.toThrow(
      'businessId must be null',
    );
    await expect(notify.send({ ...smsCode, businessId: null })).rejects.toThrow(
      NotifyTemplateError,
    );
    expect(mails).toHaveLength(0);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('sends from the cleaned firm name, without bidi or zero-width characters', async () => {
    const spoof = { ...firmBranding, name: 'Sample Tax \u202Emoc.elpmaxe\u200B' };
    const mails: OutgoingEmail[] = [];
    const notify = new SendingNotifyService({
      preferences: { allows: () => Promise.resolve(true) },
      branding: { load: () => Promise.resolve(spoof) },
      email: { from: FROM, transport: { send: (m) => (mails.push(m), Promise.resolve()) } },
      sms: null,
      linkOrigins: LINK_ORIGINS,
      logger: { log: vi.fn(), warn: vi.fn() },
    });
    await notify.send(invoice);
    expect(mails[0]!.from).toEqual({ name: 'Sample Tax moc.elpmaxe', address: FROM.address });
  });

  it('turns a branding failure into the documented errors, never a raw database error', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    // A Prisma-like error whose message quotes the query's values.
    const outage = Object.assign(new Error(`Can't reach database; where id = ${FIRM_ID} ${TO}`), {
      name: 'PrismaClientInitializationError',
    });
    const forBusiness = vi.fn(() => {
      const fail = () => Promise.reject(outage);
      return { business: { findUnique: fail }, businessSettings: { findUnique: fail } };
    });
    const notify = new SendingNotifyService({
      preferences: { allows: () => Promise.resolve(true) },
      branding: new BrandingSource({ forBusiness } as never),
      email: { from: FROM, transport: { send: () => Promise.resolve() } },
      sms: null,
      linkOrigins: LINK_ORIGINS,
      logger,
    });
    const down = await notify.send(invoice).catch((e: unknown) => e);
    expect(down).toBeInstanceOf(NotifyDeliveryError);
    expect(down).toMatchObject({
      reason: 'BrandingUnavailable:PrismaClientInitializationError',
    });
    expect((down as Error).cause).toBeUndefined();
    const malformed = await notify
      .send({ ...invoice, businessId: "x' OR 1=1 --" })
      .catch((e: unknown) => e);
    expect(malformed).toBeInstanceOf(UnknownFirmError);
    expect(forBusiness).toHaveBeenCalledTimes(1);
    const seen = JSON.stringify([
      down,
      malformed,
      String(down),
      String(malformed),
      logger.warn.mock.calls,
    ]);
    for (const value of [...PRIVATE, "Can't reach", 'OR 1=1']) expect(seen).not.toContain(value);
  });

  it("adds nodemailer's error code to the reason, and only a code that looks like one", async () => {
    const refused = Object.assign(new Error(`Connection refused for ${TO}`), {
      code: 'ECONNECTION',
    });
    const error = await setup({ fail: refused })
      .notify.send(invoice)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: 'Error:ECONNECTION' });
    const odd = Object.assign(new Error('x'), { name: 'MessageRejected', code: `E ${TO}` });
    const other = await setup({ fail: odd })
      .notify.send(invoice)
      .catch((e: unknown) => e);
    expect(other).toMatchObject({ reason: 'MessageRejected' });
  });

  it('keeps the template tables in step', () => {
    expect(Object.keys(TEMPLATE_SENDER).sort()).toEqual(Object.keys(TEMPLATE_CHANNEL).sort());
    for (const t of Object.keys(TEMPLATE_SENDER) as (keyof typeof TEMPLATE_SENDER)[]) {
      expect(TEMPLATE_SENDER[t]).toBe(t.startsWith('firm-application.') ? 'platform' : 'firm');
    }
    expect(Object.values(TEMPLATE_CHANNEL).filter((c) => c === 'sms')).toHaveLength(1);
    for (const t of ALWAYS_SENT) expect(TEMPLATE_CATEGORY[t]).toBe('ACCOUNT');
    expect(Object.keys(TEMPLATE_CATEGORY).sort()).toEqual(Object.keys(TEMPLATE_CHANNEL).sort());
  });
});

describe('email and SMS adapters', () => {
  const mail: OutgoingEmail = {
    from: { name: FIRM_NAME, address: 'no-reply@dev.example.test' },
    to: TO,
    replyTo: null,
    subject: 'Subject',
    text: 'Text',
    html: '<p>Html</p>',
  };

  it('SES: one SendEmail, UTF-8, the firm as the sender name, no configuration set named', async () => {
    // The identity's default configuration set applies; naming it would need IAM on the set too.
    const send = vi.fn(() => Promise.resolve({}));
    const ses = new SesEmailTransport({ send } as unknown as Pick<SESv2Client, 'send'>);
    await ses.send({ ...mail, replyTo: 'support@example.test' });
    const [[command]] = send.mock.calls as unknown as [[{ input: unknown }]];
    expect(command.input).toEqual({
      FromEmailAddress: '"Sample & Sons <Tax> Co" <no-reply@dev.example.test>',
      Destination: { ToAddresses: [TO] },
      ReplyToAddresses: ['support@example.test'],
      Content: {
        Simple: {
          Subject: { Data: 'Subject', Charset: 'UTF-8' },
          Body: {
            Text: { Data: 'Text', Charset: 'UTF-8' },
            Html: { Data: '<p>Html</p>', Charset: 'UTF-8' },
          },
        },
      },
    });
  });

  it('SNS: a transactional Publish from the registered number', async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const sns = new SnsSmsTransport({ send } as unknown as Pick<SNSClient, 'send'>, '+18885550100');
    await sns.send({ to: PHONE, text: 'Code' });
    const [[command]] = send.mock.calls as unknown as [[{ input: unknown }]];
    expect(command.input).toEqual({
      PhoneNumber: PHONE,
      Message: 'Code',
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        'AWS.MM.SMS.OriginationNumber': { DataType: 'String', StringValue: '+18885550100' },
      },
    });
  });

  it('SMTP: a MIME message with the firm as the sender name, text and HTML', async () => {
    const stream = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const raw: string[] = [];
    const transporter: MailTransporter = {
      sendMail: async (m) => {
        const info = await stream.sendMail(m);
        raw.push(String(info.message));
        return info;
      },
    };
    await new SmtpEmailTransport(transporter).send({ ...mail, replyTo: 'support@example.test' });
    expect(raw[0]).toContain('From: "Sample & Sons <Tax> Co" <no-reply@dev.example.test>');
    expect(raw[0]).toContain(`To: ${TO}`);
    expect(raw[0]).toContain('Reply-To: support@example.test');
    expect(raw[0]).toContain('Content-Type: text/html');
  });

  it('formats sender names safely', () => {
    expect(formatSender({ name: null, address: 'a@example.test' })).toBe('a@example.test');
    expect(formatSender({ name: 'A\r\nBcc: x', address: 'a@example.test' })).toBe(
      '"A Bcc: x" <a@example.test>',
    );
    expect(formatSender({ name: 'Café', address: 'a@example.test' })).toBe(
      '=?UTF-8?B?Q2Fmw6k=?= <a@example.test>',
    );
    expect(formatSender({ name: 'Tax \u202Emoc.elpmaxe\u2066', address: 'a@example.test' })).toBe(
      '"Tax moc.elpmaxe" <a@example.test>',
    );
    // A long name outside ASCII: several encoded words of at most 75 characters each.
    const long = 'Société Fiscale Élégante & Associés de Montréal Québec Canada';
    const shown = formatSender({ name: long, address: 'a@example.test' });
    const words = shown.replace(/ <a@example\.test>$/, '').split(' ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = words
      .map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe(long);
  });

  it(`caps the name at ${MAX_SENDER_NAME} characters, between code points`, () => {
    const ascii = senderDisplayName(`${'A'.repeat(100)} Tax`);
    expect(ascii).toBe('A'.repeat(MAX_SENDER_NAME));
    // 63 letters and two emoji: the cut keeps the first emoji whole and drops the second.
    const emoji = senderDisplayName(`${'a'.repeat(63)}\u{1F600}\u{1F600}`);
    expect(emoji).toBe(`${'a'.repeat(63)}\u{1F600}`);
    // No lone surrogate: one would come back from UTF-8 as U+FFFD.
    expect(Buffer.from(emoji, 'utf8').toString('utf8')).toBe(emoji);
    // Cleaned first, then cut: format characters never use up the 64.
    expect(senderDisplayName(`${'​'.repeat(100)}Sample Tax`)).toBe('Sample Tax');
  });

  it('breaks up "=?" so no part of a name can decode as an encoded word', () => {
    const word = '=?UTF-8?B?4oCuZXZpbA==?=';
    const ascii = formatSender({ name: word, address: 'a@example.test' });
    expect(ascii).not.toContain('=?');
    expect(ascii).toBe('"= ?UTF-8?B?4oCuZXZpbA== ?=" <a@example.test>');
    expect(senderDisplayName('A=?=?B')).toBe('A= ?= ?B');
    expect(senderDisplayName('A=​?B')).toBe('A= ?B');
    // Outside ASCII the name is encoded; what it decodes to has no "=?" either.
    const shown = formatSender({ name: `Café ${word}`, address: 'a@example.test' });
    const decoded = shown
      .replace(/ <a@example\.test>$/, '')
      .split(' ')
      .map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe('Café = ?UTF-8?B?4oCuZXZpbA== ?=');
  });

  it('keeps a 200-character non-ASCII name within the 998-character line limit', async () => {
    const legal = '\u{1D509}é'.repeat(100);
    expect(Array.from(legal)).toHaveLength(200);
    const from = { name: legal, address: 'no-reply@dev.example.test' };
    const ses = `From: ${formatSender(from)}`;
    expect(ses.length).toBeLessThan(998);
    const decoded = formatSender(from)
      .replace(/ <no-reply@dev\.example\.test>$/, '')
      .split(' ')
      .map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe(Array.from(legal).slice(0, MAX_SENDER_NAME).join(''));
    const stream = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const raw: string[] = [];
    await new SmtpEmailTransport({
      sendMail: async (m) => {
        const info = await stream.sendMail(m);
        raw.push(String(info.message));
        return info;
      },
    }).send({ ...mail, from });
    for (const line of raw[0]!.split('\n')) expect(line.length).toBeLessThanOrEqual(998);
  });
});

describe('loadNotifyConfig', () => {
  const example = {
    NODE_ENV: 'development',
    EMAIL_MODE: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    EMAIL_FROM: 'Firmivra <no-reply@dev.example.test>',
    SMS_MODE: 'log',
    APP_BASE_URL: 'http://app.localhost:3000',
    PORTAL_BASE_URL: 'http://portal.localhost:3000',
    ADMIN_BASE_URL: 'http://admin.localhost:3000',
  };
  const localOrigins = [
    'http://app.localhost:3000',
    'http://portal.localhost:3000',
    'http://admin.localhost:3000',
  ];
  const sites = {
    APP_BASE_URL: 'https://app.dev.example.test',
    PORTAL_BASE_URL: 'https://portal.dev.example.test/',
    ADMIN_BASE_URL: 'https://admin.dev.example.test',
  };
  const devOrigins = [
    'https://app.dev.example.test',
    'https://portal.dev.example.test',
    'https://admin.dev.example.test',
  ];
  const appStack = {
    NODE_ENV: 'production',
    EMAIL_MODE: 'ses',
    EMAIL_FROM: 'no-reply@dev.example.test',
    SES_CONFIGURATION_SET: 'cs-dev',
    SMS_MODE: 'sns',
    ...sites,
  };

  it('reads .env.example as Mailpit, with texts in the log', () => {
    expect(loadNotifyConfig(example)).toEqual({
      email: { mode: 'smtp', from: FROM, host: 'localhost', port: 1025 },
      sms: { mode: 'log', unregistered: false },
      linkOrigins: localOrigins,
      jobs: true,
    });
  });

  it("reads the app stack's dev settings as SES, with texts in the log until the number is set", () => {
    expect(loadNotifyConfig(appStack)).toEqual({
      email: { mode: 'ses', from: { name: null, address: 'no-reply@dev.example.test' } },
      sms: { mode: 'log', unregistered: true },
      linkOrigins: devOrigins,
      jobs: true,
    });
    const registered = loadNotifyConfig({ ...appStack, SMS_ORIGINATION_NUMBER: '+18885550100' });
    expect(registered.sms).toEqual({ mode: 'sns', originationNumber: '+18885550100' });
  });

  it('runs the reminder jobs unless NOTIFY_JOBS=off, and not in tests unless NOTIFY_JOBS=on', () => {
    expect(loadNotifyConfig({ ...example, NOTIFY_JOBS: 'off' }).jobs).toBe(false);
    expect(loadNotifyConfig({ ...example, NODE_ENV: 'test' }).jobs).toBe(false);
    expect(loadNotifyConfig({ ...example, VITEST: 'true' }).jobs).toBe(false);
    expect(loadNotifyConfig({ ...example, NODE_ENV: 'test', NOTIFY_JOBS: 'on' }).jobs).toBe(true);
    expect(() => loadNotifyConfig({ ...example, NOTIFY_JOBS: 'yes' })).toThrow('NOTIFY_JOBS');
  });

  it('defaults to SES, so a missing setting never uses a stand-in', () => {
    expect(loadNotifyConfig({ EMAIL_FROM: 'no-reply@dev.example.test', ...sites }).email.mode).toBe(
      'ses',
    );
    expect(() => loadNotifyConfig({ NODE_ENV: 'production' })).toThrow('EMAIL_FROM');
  });

  it('refuses smtp and log outside development and test', () => {
    for (const NODE_ENV of ['production', undefined]) {
      expect(() => loadNotifyConfig({ ...example, NODE_ENV })).toThrow('EMAIL_MODE=smtp');
      expect(() => loadNotifyConfig({ NODE_ENV, EMAIL_MODE: 'log' })).toThrow('EMAIL_MODE=log');
    }
    expect(loadNotifyConfig({ NODE_ENV: 'test', EMAIL_MODE: 'log' }).email).toEqual({
      mode: 'log',
    });
  });

  it('refuses incomplete or malformed settings', () => {
    expect(() => loadNotifyConfig({ ...example, SMTP_HOST: '' })).toThrow('SMTP_HOST');
    expect(() => loadNotifyConfig({ ...example, EMAIL_FROM: 'Firmivra' })).toThrow('EMAIL_FROM');
    expect(() => loadNotifyConfig({ ...example, EMAIL_MODE: 'sendmail' })).toThrow('EMAIL_MODE');
    expect(() => loadNotifyConfig({ ...appStack, SMS_ORIGINATION_NUMBER: '555' })).toThrow(
      'SMS_ORIGINATION_NUMBER',
    );
  });

  it("needs the sites' addresses with ses and smtp: links in messages may go only there", () => {
    for (const key of Object.keys(sites)) {
      expect(() => loadNotifyConfig({ ...appStack, [key]: undefined })).toThrow(key);
      expect(() => loadNotifyConfig({ ...example, [key]: '' })).toThrow(key);
    }
    // Without sending, they may be left out; every link is then refused.
    expect(loadNotifyConfig({ NODE_ENV: 'test', EMAIL_MODE: 'log' }).linkOrigins).toEqual([]);
  });

  it('refuses http sites in production, a user name or password, and non-web addresses', () => {
    expect(() =>
      loadNotifyConfig({ ...appStack, APP_BASE_URL: 'http://app.dev.example.test' }),
    ).toThrow('APP_BASE_URL');
    expect(() => loadNotifyConfig({ ...appStack, NODE_ENV: undefined })).not.toThrow();
    expect(() =>
      loadNotifyConfig({ ...appStack, NODE_ENV: undefined, ADMIN_BASE_URL: 'http://a.test' }),
    ).toThrow('ADMIN_BASE_URL');
    for (const bad of [
      'https://user@portal.dev.example.test',
      'https://user:secret@portal.dev.example.test',
      'javascript:alert(1)',
      'ftp://portal.dev.example.test',
      'portal.dev.example.test',
    ]) {
      expect(() => loadNotifyConfig({ ...appStack, PORTAL_BASE_URL: bad })).toThrow(
        'PORTAL_BASE_URL',
      );
    }
    // http is for development and test only.
    expect(loadNotifyConfig(example).linkOrigins).toEqual(localOrigins);
  });

  it('parses senders', () => {
    expect(parseSender('"Firmivra Team" <a@example.test>')).toEqual({
      name: 'Firmivra Team',
      address: 'a@example.test',
    });
    expect(parseSender('<a@example.test>')).toEqual({ name: null, address: 'a@example.test' });
    expect(parseSender('not an address')).toBeNull();
  });
});

describe('BrandingSource', () => {
  const db = (business: object | null, settings: object | null) => {
    const forBusiness = vi.fn(() => ({
      business: { findUnique: () => Promise.resolve(business) },
      businessSettings: { findUnique: () => Promise.resolve(settings) },
    }));
    return { forBusiness, source: new BrandingSource({ forBusiness } as never) };
  };

  it("reads the firm's name, colours and zone in the firm's own scope", async () => {
    const { forBusiness, source } = db(
      { name: FIRM_NAME },
      { brandColor: '#0a7c59', accentColor: null, timezone: 'America/Chicago' },
    );
    expect(await source.load(FIRM_ID)).toEqual({
      name: FIRM_NAME,
      primaryColor: '#0A7C59',
      accentColor: '#C9A227',
      logoUrl: null,
      timeZone: 'America/Chicago',
      isFirm: true,
    });
    expect(forBusiness).toHaveBeenCalledWith(FIRM_ID);
  });

  it('falls back for bad values, uses Firmivra for platform mail, refuses an unknown firm', async () => {
    const odd = db({ name: 'Sample' }, { brandColor: 'red', timezone: 'Mars/Base' });
    expect(await odd.source.load(FIRM_ID)).toMatchObject({
      primaryColor: '#1F3A6B',
      timeZone: 'America/New_York',
    });
    expect(await odd.source.load(null)).toBe(FIRMIVRA_BRANDING);
    expect(odd.forBusiness).toHaveBeenCalledTimes(1);
    await expect(db(null, null).source.load(FIRM_ID)).rejects.toThrow(UnknownFirmError);
  });

  it('refuses a businessId that is not a UUID before any query', async () => {
    const { forBusiness, source } = db({ name: 'Sample' }, null);
    for (const bad of ['', 'lvp', `${FIRM_ID}x`, "x' OR 1=1 --", 42 as unknown as string]) {
      await expect(source.load(bad)).rejects.toThrow(UnknownFirmError);
    }
    expect(forBusiness).not.toHaveBeenCalled();
  });
});
