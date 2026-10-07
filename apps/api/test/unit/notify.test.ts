import { describe, expect, it, vi } from 'vitest';
import { LogNotifyService } from '../../src/notify/log-notify.service.js';
import {
  ALWAYS_SENT,
  type NotifyMessage,
  TEMPLATE_CHANNEL,
} from '../../src/notify/notify.types.js';

const code: NotifyMessage<'client.signup-sms-code'> = {
  template: 'client.signup-sms-code',
  to: '+17705550199',
  businessId: '00000000-0000-4000-8000-000000000001',
  data: { firmName: 'LVP Accounting & Taxes', code: '482913' },
};
const invite: NotifyMessage<'staff.invite'> = {
  template: 'staff.invite',
  to: 'sam@example.test',
  businessId: '00000000-0000-4000-8000-000000000001',
  data: {
    name: 'Sam Staff',
    firmName: 'LVP Accounting & Taxes',
    link: 'http://app.localhost:3000/activate#token=secret-token',
    expiresAt: new Date('2026-10-14T09:00:00Z'),
  },
};

describe('LogNotifyService (until R6 step 2)', () => {
  it('logs the whole message in local mode, so developers can use codes and links', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const notify = new LogNotifyService(true, logger);
    await notify.send(code);
    await notify.send(invite);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('482913'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('#token=secret-token'));
  });

  it('never logs an address, a code, a link or other data anywhere else (hard rule 4)', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const notify = new LogNotifyService(false, logger);
    await notify.send(code);
    await notify.send(invite);
    await notify.send({
      template: 'firm-application.declined',
      to: 'jordan@sample-tax.example.test',
      businessId: null,
      data: { name: 'Jordan Sample', legalName: 'Sample Tax Partners LLC', reason: 'Not a firm' },
    });
    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    for (const secret of [
      '482913',
      '5550199',
      'sam@example.test',
      'secret-token',
      'Sam Staff',
      'Not a firm',
      'jordan@',
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logged).toContain('Firmivra');
  });

  it('rejects a template that does not exist (a programming error)', async () => {
    const notify = new LogNotifyService(true, { log: vi.fn(), warn: vi.fn() });
    const bad = { ...invite, template: 'no.such-template' } as unknown as NotifyMessage;
    await expect(notify.send(bad)).rejects.toThrow('Unknown template');
  });

  it('sends codes by SMS only where the template says, and keeps sign-in mail out of preferences', () => {
    expect(TEMPLATE_CHANNEL['client.signup-sms-code']).toBe('sms');
    expect(Object.values(TEMPLATE_CHANNEL).filter((c) => c === 'sms')).toHaveLength(1);
    for (const t of ALWAYS_SENT) expect(TEMPLATE_CHANNEL[t]).toBeDefined();
    expect(ALWAYS_SENT.has('document.requested')).toBe(false);
  });
});
