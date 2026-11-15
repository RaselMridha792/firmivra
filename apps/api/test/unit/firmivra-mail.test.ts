// R55, Leads Review Two row 14: Firmivra Mail's adapter (communications/firmivra-mail.ts). Live
// sends to anyone; holding sends only to the firm's own team or an exact listed address, and holds
// the rest; a domain in the list is ignored. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { DeliveryError } from '../../src/communications/communications-provider.js';
import {
  campaignMailMode,
  FirmivraMailProvider,
  HELD_ON_DEV,
  testRecipients,
  textOf,
} from '../../src/communications/firmivra-mail.js';
import type { OutgoingEmail } from '../../src/notify/transports.js';

const firm = '11111111-1111-4111-8111-111111111111';
const team = 'owner@firm.test';

/** A firm whose only ACTIVE member logs in as `team`. */
const database = {
  forBusiness: () => ({
    membership: {
      findFirst: ({ where }: { where: { user: { email: { equals: string } } } }) =>
        Promise.resolve(where.user.email.equals === team ? { userId: 'u' } : null),
    },
  }),
} as unknown as ConstructorParameters<typeof FirmivraMailProvider>[0];

const provider = (mode: 'live' | 'hold', list: string[] = []) => {
  const sent: OutgoingEmail[] = [];
  const p = new FirmivraMailProvider(
    database,
    {
      transport: { send: (m) => (sent.push(m), Promise.resolve()) },
      from: { name: 'Firmivra', address: 'campaigns@firmivra.test' },
    },
    mode,
    new Set(list),
  );
  return { p, sent };
};
const message = (to: string) => ({
  channel: 'EMAIL' as const,
  connectionId: '22222222-2222-4222-8222-222222222222',
  businessId: firm,
  to,
  fromName: 'Sample Firm',
  replyTo: null,
  subject: 'Hi',
  body: '<p>Hello &amp; welcome</p><p>Two</p>',
  reference: 'r',
});

describe('Firmivra Mail', () => {
  it('live: sends to anyone, from the firm’s name on the platform address', async () => {
    const { p, sent } = provider('live');
    await expect(p.send(message('client@gmail.com'))).resolves.toMatchObject({
      messageId: expect.stringMatching(/^firmivra-mail-/),
    });
    expect(sent[0]).toMatchObject({
      to: 'client@gmail.com',
      from: { name: 'Sample Firm', address: 'campaigns@firmivra.test' },
      text: 'Hello & welcome\nTwo',
    });
  });

  it('holding: the team and listed addresses go; a gmail client is held and never sent', async () => {
    const { p, sent } = provider('hold', ['tester@example.test']);
    await p.send(message('OWNER@firm.test'));
    await p.send(message('tester@example.test'));
    const held = await p.send(message('client@gmail.com')).catch((e: unknown) => e);
    expect(held).toBeInstanceOf(DeliveryError);
    expect(held).toMatchObject({ code: HELD_ON_DEV, retry: false });
    expect(sent.map((m) => m.to)).toEqual(['OWNER@firm.test', 'tester@example.test']);
  });

  it('reads the switch and the list: only "live" sends to all; domains are ignored', () => {
    expect(campaignMailMode({})).toBe('hold');
    expect(campaignMailMode({ COMMUNICATIONS_MAIL: 'LIVE' })).toBe('hold');
    expect(campaignMailMode({ COMMUNICATIONS_MAIL: 'live' })).toBe('live');
    expect([
      ...testRecipients({
        COMMUNICATIONS_TEST_RECIPIENTS: ' A@Example.test, @gmail.com, gmail.com, bad, b@x.test ',
      }),
    ]).toEqual(['a@example.test', 'b@x.test']);
  });

  it('a plain-text copy of the HTML', () => {
    expect(textOf('<h1>Title</h1><p>A&nbsp;b &lt;c&gt;</p><br>end')).toBe('Title\nA b <c>\n\nend');
  });
});
