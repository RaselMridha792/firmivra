// R6 step 6: R2's invite emails and R3's sign-up codes and notices go through NotifyService.
import { describe, expect, it, vi } from 'vitest';
import { NotifyActivationMailer, NotifyClientCodeSender } from '../../src/notify/adapters.js';
import type { NotifyMessage, NotifyService } from '../../src/notify/notify.types.js';

const businessId = '0190a000-0000-7000-8000-000000000001';

function fakeNotify(fail = false) {
  const sent: NotifyMessage[] = [];
  const notify: NotifyService = {
    send: (m) => {
      sent.push(m as NotifyMessage);
      return fail ? Promise.reject(new Error('NotifyDeliveryError')) : Promise.resolve();
    },
  };
  return { notify, sent };
}
const logger = () => ({ log: vi.fn(), warn: vi.fn() });
const logged = (l: ReturnType<typeof logger>) =>
  JSON.stringify([...l.log.mock.calls, ...l.warn.mock.calls]);

describe('NotifyActivationMailer', () => {
  const email = {
    inviteId: 'invite-1',
    businessId,
    to: 'new@lvp.test',
    name: 'New Person',
    businessName: 'LVP',
    link: 'https://app.dev.example.test/activate#token=SECRET-TOKEN',
    expiresAt: new Date('2026-10-16T00:00:00Z'),
  };

  it("sends the firm's staff.invite email", async () => {
    const { notify, sent } = fakeNotify();
    await new NotifyActivationMailer(notify, logger()).send(email);
    expect(sent).toEqual([
      {
        template: 'staff.invite',
        to: 'new@lvp.test',
        businessId,
        data: { name: 'New Person', link: email.link, expiresAt: email.expiresAt },
      },
    ]);
  });

  it('never rejects: a failed send is logged with the invite id only', async () => {
    const { notify } = fakeNotify(true);
    const l = logger();
    await expect(new NotifyActivationMailer(notify, l).send(email)).resolves.toBeUndefined();
    expect(logged(l)).toContain('invite-1');
    expect(logged(l)).not.toContain('SECRET-TOKEN');
    expect(logged(l)).not.toContain('new@lvp.test');
  });
});

describe('NotifyClientCodeSender', () => {
  const base = { businessId, businessName: 'LVP' };
  const signInUrl = 'https://portal.dev.example.test/lvp/sign-in';

  it('sends each code and notice as its template, from the firm', async () => {
    const { notify, sent } = fakeNotify();
    const sender = new NotifyClientCodeSender(notify, false, logger());
    await sender.emailCode({ ...base, to: 'jane@example.test', code: '482913' });
    await sender.smsCode({ ...base, to: '+17705550199', code: '119922' });
    await sender.alreadyRegistered({ ...base, to: 'jane@example.test', signInUrl });
    await sender.signUpApproved({ ...base, to: 'jane@example.test', name: 'Jane', signInUrl });
    await sender.signUpDeclined({ ...base, to: 'jane@example.test', name: 'Jane' });
    expect(sent).toEqual([
      {
        template: 'client.signup-email-code',
        to: 'jane@example.test',
        businessId,
        data: { code: '482913' },
      },
      {
        template: 'client.signup-sms-code',
        to: '+17705550199',
        businessId,
        data: { code: '119922' },
      },
      {
        template: 'client.already-registered',
        to: 'jane@example.test',
        businessId,
        data: { signInLink: signInUrl },
      },
      {
        template: 'client.signup-approved',
        to: 'jane@example.test',
        businessId,
        data: { name: 'Jane', signInLink: signInUrl },
      },
      {
        template: 'client.signup-declined',
        to: 'jane@example.test',
        businessId,
        data: { name: 'Jane' },
      },
    ]);
  });

  it('rejects as NotifyService does (the callers log the account id)', async () => {
    const { notify } = fakeNotify(true);
    const sender = new NotifyClientCodeSender(notify, false, logger());
    await expect(sender.emailCode({ ...base, to: 'j@example.test', code: '1' })).rejects.toThrow();
  });

  it('logs an SMS code only with AUTH_MODE=local; never a code or number otherwise', async () => {
    const local = logger();
    await new NotifyClientCodeSender(fakeNotify().notify, true, local).smsCode({
      ...base,
      to: '+17705550199',
      code: '119922',
    });
    expect(logged(local)).toContain('119922');

    const remote = logger();
    const sender = new NotifyClientCodeSender(fakeNotify().notify, false, remote);
    await sender.smsCode({ ...base, to: '+17705550199', code: '119922' });
    await sender.emailCode({ ...base, to: 'jane@example.test', code: '482913' });
    expect(logged(remote)).not.toMatch(/119922|482913|5550199|jane@/);
  });
});
