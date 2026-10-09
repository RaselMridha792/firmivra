// Firm Sign emails (R13). Synthetic data only (example.test).
import { describe, expect, it } from 'vitest';
import type { Branding } from '../../src/notify/branding.js';
import {
  ALWAYS_SENT,
  ESIGN_STAFF_EVENTS,
  type NotifyTemplate,
  TEMPLATE_CATEGORY,
  TEMPLATE_CHANNEL,
} from '../../src/notify/notify.types.js';
import {
  NotifyTemplateError,
  type RenderedEmail,
  escapeHtml,
  render,
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
const email = <T extends NotifyTemplate>(t: T, data = SAMPLE_DATA[t]) =>
  render(t, data, firm, { linkOrigins: LINK_ORIGINS }) as RenderedEmail;
const esign = (Object.keys(TEMPLATE_CHANNEL) as NotifyTemplate[]).filter((t) =>
  t.startsWith('esign.'),
);
const SIGN = 'https://portal.example.test/sample/sign#t=synthetic-sign-token';
const WORKSPACE = 'https://app.example.test/esign/requests/synthetic-id';
const HOSTILE = '<script>alert(1)</script> "Q" & <img src=x onerror=y>';

describe('Firm Sign emails', () => {
  it('has the nine templates, all firm emails; the code, request and expiry always go out', () => {
    expect(esign).toHaveLength(9);
    for (const t of esign) expect(TEMPLATE_CHANNEL[t]).toBe('email');
    expect(esign.filter((t) => ALWAYS_SENT.has(t)).sort()).toEqual([
      'esign.code',
      'esign.expiring',
      'esign.request',
    ]);
    for (const t of ['esign.code', 'esign.request', 'esign.expiring'] as const)
      expect(TEMPLATE_CATEGORY[t]).toBe('ACCOUNT');
    expect(TEMPLATE_CATEGORY['esign.reminder']).toBe('DOCUMENTS');
  });

  it('esign.request: sender, title, escaped message and the signing link', () => {
    const out = email('esign.request');
    expect(out.subject).toBe(`${FIRM_NAME} asks you to sign "2025 Form 8879"`);
    expect(out.fromName).toBe(FIRM_NAME);
    expect(out.text).toContain(`Sam Staff at ${FIRM_NAME} asks you to sign "2025 Form 8879".`);
    expect(out.text).toContain(
      'Message from Sam Staff:\n> Please sign <b>your</b> return.\n> Thanks.',
    );
    expect(out.text).toContain(`Review and sign:\n${SIGN}`);
    expect(out.html).toContain('&lt;b&gt;your&lt;/b&gt; return.<br>Thanks.');
    expect(out.html).toContain(`href="${SIGN}"`);
    const none = email('esign.request', { ...SAMPLE_DATA['esign.request'], message: '  \n ' });
    expect(none.text).not.toContain('Message from');
  });

  it('esign.request caps the title at 200 and the message at 1000 characters', () => {
    const out = email('esign.request', {
      ...SAMPLE_DATA['esign.request'],
      title: 'T'.repeat(500),
      message: 'M'.repeat(5000),
    });
    expect(out.subject).toContain(`"${'T'.repeat(199)}…"`);
    expect(out.subject).not.toContain('T'.repeat(200));
    expect(out.text).toContain(`> ${'M'.repeat(999)}…`);
    expect(out.text).not.toContain('M'.repeat(1000));
  });

  it('esign.code: the code, valid 15 minutes', () => {
    const out = email('esign.code');
    expect(out.subject).toBe(`Your ${FIRM_NAME} signing code`);
    expect(out.text).toContain('    482913');
    expect(out.text).toContain('expires in 15 minutes');
    expect(out.html).toContain('>482913</p>');
    expect(() => email('esign.code', { code: '12 34', title: 'X' })).toThrow('Invalid code');
  });

  it('esign.reminder and esign.expiring carry the link; the date is in the firm zone', () => {
    const reminder = email('esign.reminder');
    expect(reminder.subject).toBe(`Reminder: ${FIRM_NAME} is waiting for your signature`);
    expect(reminder.text).toContain(`asked you to sign "2025 Form 8879"`);
    expect(reminder.text).toContain(SIGN);
    const expiring = email('esign.expiring');
    expect(expiring.subject).toBe(`"2025 Form 8879" from ${FIRM_NAME} expires soon`);
    expect(expiring.text).toContain('expires on Thursday, October 29, 2026 at 11:59 PM EDT.');
    expect(expiring.html).toContain(`href="${SIGN}"`);
  });

  it('esign.completed: a copy link for an external signer, the portal for a client', () => {
    const external = email('esign.completed');
    expect(external.subject).toBe('"2025 Form 8879" is signed');
    expect(external.text).toContain(`Everyone has signed "2025 Form 8879" for ${FIRM_NAME}.`);
    expect(external.text).toContain(
      'Download your copy:\nhttps://portal.example.test/sample/sign#t=synthetic-copy-token',
    );
    expect(external.text).toContain('30 days');
    const portal = email('esign.completed', {
      name: 'Robin Example',
      title: '2025 Form 8879',
      portalLink: 'https://portal.example.test/sample/signatures',
    });
    expect(portal.text).toContain('find the signed copy in your client portal');
    expect(portal.text).toContain('https://portal.example.test/sample/signatures');
    expect(portal.text).not.toContain('30 days');
  });

  it('esign.declined names the signer and the title, never the reason', () => {
    const data = { ...SAMPLE_DATA['esign.declined'], reason: 'Synthetic private reason' };
    const out = email('esign.declined', data as never);
    expect(out.subject).toBe('"2025 Form 8879" was declined');
    expect(out.text).toContain('Robin Example declined to sign "2025 Form 8879".');
    expect(out.text).toContain(WORKSPACE);
    expect(JSON.stringify(out)).not.toContain('Synthetic private');
  });

  it('esign.voided says the firm cancelled it, with no reason and no link', () => {
    const data = { ...SAMPLE_DATA['esign.voided'], reason: 'Synthetic private reason' };
    const out = email('esign.voided', data as never);
    expect(out.subject).toBe(`${FIRM_NAME} cancelled "2025 Form 8879"`);
    expect(out.text).toContain('You do not need to do anything.');
    expect(JSON.stringify(out)).not.toContain('Synthetic private');
    expect(out.html).not.toContain('href=');
  });

  it('esign.approval-requested names the sender and links to the workspace', () => {
    const out = email('esign.approval-requested');
    expect(out.subject).toBe('Approval needed: "2025 Form 8879"');
    expect(out.text).toContain('Hi Alex Manager,');
    expect(out.text).toContain('Sam Staff asks you to approve sending "2025 Form 8879"');
    expect(out.text).toContain(`Review the request:\n${WORKSPACE}`);
  });

  it.each([
    ['VIEWED', 'Robin Example opened "2025 Form 8879".'],
    ['SIGNED', 'Robin Example signed "2025 Form 8879".'],
    ['COMPLETED', 'Everyone has signed "2025 Form 8879".'],
    ['EXPIRED', '"2025 Form 8879" expired before everyone signed.'],
  ] as const)('esign.staff-update %s reads as plain words', (event, words) => {
    const out = email('esign.staff-update', { ...SAMPLE_DATA['esign.staff-update'], event });
    expect(out.subject).toBe('Update on "2025 Form 8879"');
    expect(out.text).toContain(words);
    expect(out.text).toContain(WORKSPACE);
  });

  it('esign.staff-update covers every event and refuses an unknown one', () => {
    expect(ESIGN_STAFF_EVENTS).toEqual(['VIEWED', 'SIGNED', 'COMPLETED', 'EXPIRED']);
    const data = { ...SAMPLE_DATA['esign.staff-update'], signerName: null, event: 'VIEWED' };
    expect(email('esign.staff-update', data as never).text).toContain('A recipient opened');
    const bad = { ...data, event: 'DECLINED' };
    expect(() => email('esign.staff-update', bad as never)).toThrow(NotifyTemplateError);
  });

  it('esign.staff-update says who is next after a signature', () => {
    const data = { ...SAMPLE_DATA['esign.staff-update'], waitingOn: ['Pat Partner', 'Lee Lane'] };
    expect(email('esign.staff-update', data).text).toContain(
      'Now waiting on Pat Partner, Lee Lane.',
    );
    const viewed = { ...data, event: 'VIEWED' as const };
    expect(email('esign.staff-update', viewed).text).not.toContain('Now waiting on');
  });

  it.each(esign)('%s escapes a hostile title and names in the HTML', (t) => {
    const sample = SAMPLE_DATA[t];
    const data = {
      ...sample,
      title: HOSTILE,
      ...('senderName' in sample ? { senderName: HOSTILE } : {}),
      ...('signerName' in sample ? { signerName: HOSTILE } : {}),
    };
    const out = email(t, data as never);
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain(escapeHtml('<script>alert(1)</script>'));
  });

  it.each(esign)('%s refuses a link to anywhere but a Firmivra site', (t) => {
    const data = SAMPLE_DATA[t] as Record<string, unknown>;
    const key = ['link', 'copyLink'].find((k) => k in data);
    if (!key) return;
    const bad = { ...data, [key]: 'https://evil.example.org/sign#t=x' };
    expect(() => email(t, bad as never)).toThrow(NotifyTemplateError);
  });

  it('esign.completed refuses a portal link to another site', () => {
    const data = {
      name: 'Robin Example',
      title: '2025 Form 8879',
      portalLink: 'https://evil.example.org/x',
    };
    expect(() => email('esign.completed', data)).toThrow(NotifyTemplateError);
  });

  it('refuses a missing title', () => {
    const data = { ...SAMPLE_DATA['esign.reminder'], title: ' ' };
    expect(() => email('esign.reminder', data)).toThrow('Template data needs title');
  });
});
