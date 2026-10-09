// Unit: R6 step 7's text per event and stored type names, and step 5 in NotifyService (an off
// channel is skipped; ALWAYS_SENT, ACCOUNT and messages without a recipient never ask).
import { NOTIFICATION_EVENTS, type NotificationEvent } from '@firmivra/types';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  eventOfType,
  notificationText,
  storedType,
} from '../../src/notifications/notification-text.js';
import { NotificationInputError, Notifier, short } from '../../src/notifications/notifier.js';
import { BrandingSource, FIRMIVRA_BRANDING, UnknownFirmError } from '../../src/notify/branding.js';
import { NotifyDeliveryError, SendingNotifyService } from '../../src/notify/notify.service.js';
import { PreferenceSource } from '../../src/notify/preferences.js';
import { NotifyTemplateError } from '../../src/notify/templates.js';
import { FIRM_NAME, LINK_ORIGINS, SAMPLE_DATA } from './notify-fixtures.js';

const EVENTS = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];
/** The database's rule for notifications.type (notifications_type_key). */
const TYPE_RULE = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

describe('notification text', () => {
  it('stores every event as a type the database accepts, and reads it back', () => {
    for (const event of EVENTS) {
      expect(storedType(event)).toMatch(TYPE_RULE);
      expect(eventOfType(storedType(event))).toBe(event);
    }
    expect(new Set(EVENTS.map(storedType)).size).toBe(EVENTS.length);
  });

  it('writes a title and body for every event on both sides from safe values only', () => {
    const payload = {
      title: '2025 W-2',
      dueOn: '2026-10-31',
      client: 'Jamie Sample',
      number: 'INV-7',
      name: 'Sam Staff',
      status: 'IN_PROGRESS',
      taxYear: 2025,
      formType: '1040',
      startsAt: '2026-10-20T14:30:00.000Z',
      timeZone: 'America/Chicago',
    };
    for (const event of EVENTS) {
      for (const side of ['client', 'staff'] as const) {
        const t = notificationText(
          storedType(event),
          NOTIFICATION_EVENTS[event].category,
          payload,
          side,
        );
        expect(t.title.length).toBeGreaterThan(0);
        expect(t.body.length).toBeGreaterThan(0);
        // The client's name is for the firm's staff; client items never show it.
        if (side === 'client' && NOTIFICATION_EVENTS[event].to !== 'staff') {
          expect(t.body).not.toContain('Jamie Sample');
        }
      }
    }
    expect(notificationText('document.requested', 'DOCUMENTS', payload, 'client')).toEqual({
      title: 'New document request',
      body: '2025 W-2, due Oct 31, 2026',
    });
    expect(notificationText('appointment.booked', 'APPOINTMENTS', payload, 'staff').body).toBe(
      'Jamie Sample: 2025 W-2, Oct 20, 2026, 9:30 AM',
    );
    expect(notificationText('tax_return.status_changed', 'SERVICES', payload, 'client').body).toBe(
      '2025 1040 tax return: In progress',
    );
  });

  it('never shows a raw payload: unknown events and odd payloads get plain lines', () => {
    const secret = { body: 'message text', fileName: 'w2.pdf', amount: 1234 };
    expect(notificationText('billing.something_new', 'BILLING', secret, 'client')).toEqual({
      title: 'Invoices and payments',
      body: 'You have a new notification.',
    });
    for (const event of EVENTS) {
      const t = JSON.stringify(
        notificationText(storedType(event), NOTIFICATION_EVENTS[event].category, secret, 'staff'),
      );
      for (const value of ['message text', 'w2.pdf', '1234']) expect(t).not.toContain(value);
    }
    expect(notificationText('invoice.sent', 'BILLING', ['x'], 'client').body).toBe(
      'You have a new invoice.',
    );
  });
});

describe('NotifyService and preferences (step 5)', () => {
  const FIRM_ID = '00000000-0000-4000-8000-000000000001';
  const USER_ID = '00000000-0000-4000-8000-000000000002';
  const TO = 'robin@example.test';

  function setup(
    allows: () => Promise<boolean>,
    branding: Pick<BrandingSource, 'load'> = {
      load: (id) =>
        Promise.resolve(
          id ? { ...FIRMIVRA_BRANDING, name: FIRM_NAME, isFirm: true } : FIRMIVRA_BRANDING,
        ),
    },
  ) {
    const mails: unknown[] = [];
    const texts: unknown[] = [];
    const logger = { log: vi.fn(), warn: vi.fn() };
    const preferences = { allows: vi.fn(allows) };
    const notify = new SendingNotifyService({
      branding,
      preferences,
      email: {
        from: { name: null, address: 'no-reply@example.test' },
        transport: { send: (m) => (mails.push(m), Promise.resolve()) },
      },
      sms: { send: (s) => (texts.push(s), Promise.resolve()) },
      linkOrigins: LINK_ORIGINS,
      logger,
    });
    const logged = () => JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    return { notify, mails, texts, preferences, logged };
  }
  const invoice = {
    template: 'invoice.sent' as const,
    to: TO,
    businessId: FIRM_ID,
    recipient: { userId: USER_ID },
    data: SAMPLE_DATA['invoice.sent'],
  };

  it('skips a message whose category the recipient switched off, and logs the template only', async () => {
    const s = setup(() => Promise.resolve(false));
    await expect(s.notify.send(invoice)).resolves.toBeUndefined();
    expect(s.mails).toEqual([]);
    expect(s.preferences.allows).toHaveBeenCalledWith(
      FIRM_ID,
      { userId: USER_ID },
      'BILLING',
      'email',
    );
    expect(s.logged()).toContain('turned this off');
    expect(s.logged()).not.toContain(TO);
  });

  it('never asks for ALWAYS_SENT templates or messages without a recipient', async () => {
    const s = setup(() => Promise.resolve(false));
    await s.notify.send({
      template: 'client.signup-sms-code',
      to: '+17705550199',
      businessId: FIRM_ID,
      recipient: { userId: USER_ID },
      data: SAMPLE_DATA['client.signup-sms-code'],
    });
    await s.notify.send({ ...invoice, recipient: undefined });
    expect(s.preferences.allows).not.toHaveBeenCalled();
    expect([s.texts.length, s.mails.length]).toEqual([1, 1]);
  });

  it('a recipient id that is not a UUID is a programming error; a failed read is a failed delivery', async () => {
    const bad = setup(() => Promise.resolve(true));
    await expect(
      bad.notify.send({ ...invoice, recipient: { clientAccountId: 'nope' } }),
    ).rejects.toBeInstanceOf(NotifyTemplateError);
    const down = setup(() => Promise.reject(new Error(`connection lost for ${TO}`)));
    const error = await down.notify.send(invoice).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotifyDeliveryError);
    expect(error).toMatchObject({ reason: 'PreferencesUnavailable:Error' });
    expect(JSON.stringify([String(error), down.logged()])).not.toContain(TO);
  });

  it('says "turn off emails like this" only to someone with an account who can', async () => {
    const s = setup(() => Promise.resolve(true));
    await s.notify.send(invoice);
    await s.notify.send({ ...invoice, recipient: undefined });
    const [toAccount, toAddress] = s.mails.map((m) => JSON.stringify(m));
    expect(toAccount).toContain('turn off emails like this in your notification settings');
    expect(toAddress).not.toContain('notification settings');
  });

  it('an unknown or malformed firm is UnknownFirmError before any preference is read', async () => {
    const noFirm = new BrandingSource({
      forBusiness: () => ({
        business: { findUnique: () => Promise.resolve(null) },
        businessSettings: { findUnique: () => Promise.resolve(null) },
      }),
    } as never);
    for (const businessId of ["x' OR 1=1 --", FIRM_ID]) {
      const s = setup(() => Promise.resolve(false), noFirm);
      const error = await s.notify.send({ ...invoice, businessId }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnknownFirmError);
      expect(s.preferences.allows).not.toHaveBeenCalled();
    }
  });
});

describe('PreferenceSource', () => {
  const FIRM_ID = '00000000-0000-4000-8000-000000000001';
  const USER_ID = '00000000-0000-4000-8000-000000000002';

  it('the locked ACCOUNT category always goes out, without a query, on both channels', async () => {
    const forBusiness = vi.fn(() => {
      throw new Error('queried');
    });
    const source = new PreferenceSource({ forBusiness } as never);
    for (const channel of ['email', 'sms'] as const) {
      await expect(source.allows(FIRM_ID, { userId: USER_ID }, 'ACCOUNT', channel)).resolves.toBe(
        true,
      );
    }
    expect(forBusiness).not.toHaveBeenCalled();
  });

  it("reads the person's own choice, and the defaults (email on, SMS off) without one", async () => {
    const row = { email: false, sms: true };
    const findUnique = vi.fn(() => Promise.resolve<typeof row | null>(row));
    const source = new PreferenceSource({
      forBusiness: () => ({ notificationPreference: { findUnique } }),
    } as never);
    expect(await source.allows(FIRM_ID, { userId: USER_ID }, 'BILLING', 'email')).toBe(false);
    expect(await source.allows(FIRM_ID, { userId: USER_ID }, 'BILLING', 'sms')).toBe(true);
    findUnique.mockResolvedValue(null);
    expect(await source.allows(FIRM_ID, { userId: USER_ID }, 'BILLING', 'email')).toBe(true);
    expect(await source.allows(FIRM_ID, { userId: USER_ID }, 'BILLING', 'sms')).toBe(false);
  });
});

describe('Notifier input and failures', () => {
  const FIRM_ID = '00000000-0000-4000-8000-000000000001';
  const RECORD_ID = '00000000-0000-4000-8000-000000000003';

  function notifierWith(withScope: () => Promise<unknown>) {
    const send = vi.fn(() => Promise.resolve());
    const database = { withScope: vi.fn(withScope) };
    return { notifier: new Notifier(database as never, { send }, {} as never), send, database };
  }

  it('a message goes one way: message.received needs audience client or staff', async () => {
    const { notifier, database } = notifierWith(() => Promise.resolve([]));
    for (const audience of [undefined, 'both'] as const) {
      await expect(
        notifier.notify({
          businessId: FIRM_ID,
          event: 'message.received',
          recordId: RECORD_ID,
          ...(audience ? { audience } : {}),
        }),
      ).rejects.toBeInstanceOf(NotificationInputError);
    }
    expect(database.withScope).not.toHaveBeenCalled();
  });

  it('a database failure is { written: 0, failed: true }, logged with ids only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { notifier, send } = notifierWith(() =>
        Promise.reject(new Error('timeout for robin@example.test')),
      );
      expect(
        await notifier.notify({ businessId: FIRM_ID, event: 'invoice.sent', recordId: RECORD_ID }),
      ).toEqual({ written: 0, failed: true });
      expect(send).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('robin@');
      expect(JSON.stringify(warn.mock.calls)).toContain(RECORD_ID);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('short (titles and names in a bell item)', () => {
  it('cuts at 120 code points, never inside a surrogate pair (jsonb refuses a lone one)', () => {
    const value = `${'a'.repeat(119)}😀tail`;
    const cut = short(value)!;
    expect(Array.from(cut)).toHaveLength(120);
    expect(cut.endsWith('😀')).toBe(true);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(short('  one\n‮two  ')).toBe('one two');
    expect(short('   ')).toBeNull();
  });
});
