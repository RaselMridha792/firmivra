// End-to-end: R6 step 7, the reminder jobs (appointment.reminder, client-note.reminder, and Tax
// Planning Review 2's project-deadline.reminder) under
// their advisory lock (q30), against the database. The jobs are off in tests (NOTIFY_JOBS); each
// test runs them by hand for its own firm (one run covers both firms, for isolation).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { Notifier } from '../../src/notifications/notifier.js';
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_AFTER_MS,
  JOB_LOCK_KEYS,
  REMINDER_BACKOFF_MS,
  ReminderJobs,
} from '../../src/notifications/reminder-jobs.js';
import type { NotifyConfig } from '../../src/notify/config.js';
import { NOTIFY_CONFIG } from '../../src/notify/notify.module.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const HOUR = 60 * 60_000;
const person = (key: string, pool: 'STAFF' | 'CLIENT') => ({
  id: randomUUID(),
  email: `r6j-${key}-${run}@r6.test`,
  name: `Fake R6j ${key}`,
  pool,
});
const people = {
  owner: person('owner', 'STAFF'),
  staff: person('staff', 'STAFF'),
  other: person('other', 'STAFF'),
  primary: person('primary', 'CLIENT'),
  ownerB: person('owner-b', 'STAFF'),
  primaryB: person('primary-b', 'CLIENT'),
};
type Who = (typeof people)[keyof typeof people];
const ids = {
  firm: '',
  firmB: '',
  client: '',
  due: '',
  far: '',
  justBooked: '',
  cancelled: '',
  dueB: '',
  clientB: '',
  noteDue: '',
  noteLater: '',
  invoice: '',
};

let app: INestApplication;
let jobs: ReminderJobs;
let notifier: Notifier;
const outbox: NotifyMessage[] = [];
/** Set `failing` to make the fake sender refuse every message; `during` runs inside a send. */
const delivery: { failing: boolean; during?: () => Promise<void> } = { failing: false };
const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

async function inFirm<T>(businessId: string, work: (tx: TxClient) => Promise<T>, actor?: string) {
  const db = owner();
  try {
    return await runInScope(
      db,
      actor
        ? { kind: 'business', businessId, actorUserId: actor }
        : { kind: 'business', businessId },
      work,
    );
  } finally {
    await db.$disconnect();
  }
}

const bell = (who: Who, entityId: string, businessId = ids.firm) =>
  inFirm(businessId, (tx) =>
    tx.notification.findMany({ where: { recipientUserId: who.id, entityId } }),
  );
const appointment = (id: string, businessId = ids.firm) =>
  inFirm(businessId, (tx) => tx.appointment.findFirstOrThrow({ where: { id } }));
const only = { businessIds: [] as string[] };

beforeAll(async () => {
  const db = owner();
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: p.pool, email: p.email, name: p.name },
      });
    }
    ids.firm = (
      await tx.business.create({ data: { slug: `r6j-${run}`, name: 'Fake R6j', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({
        data: { slug: `r6j-b-${run}`, name: 'Fake R6j B', status: 'ACTIVE' },
      })
    ).id;
  });
  const now = Date.now();
  await runInScope(db, { kind: 'business', businessId: ids.firm }, async (tx) => {
    const A = { businessId: ids.firm };
    for (const [who, role] of [
      [people.owner, 'OWNER'],
      [people.staff, 'STAFF'],
      [people.other, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId: who.id, role, status: 'ACTIVE' } });
    }
    ids.client = (
      await tx.client.create({
        data: { ...A, displayName: 'Jamie Sample (fake)', assignedUserId: people.staff.id },
      })
    ).id;
    await tx.clientAccount.create({
      data: {
        ...A,
        userId: people.primary.id,
        clientId: ids.client,
        email: people.primary.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
    });
    const book = async (startsIn: number, bookedAgo: number) =>
      (
        await tx.appointment.create({
          data: {
            ...A,
            clientId: ids.client,
            staffUserId: people.staff.id,
            startsAt: new Date(now + startsIn),
            endsAt: new Date(now + startsIn + HOUR / 2),
            locationKind: 'PHONE',
            createdAt: new Date(now - bookedAgo),
          },
        })
      ).id;
    ids.due = await book(3 * HOUR, 5 * HOUR);
    ids.far = await book(72 * HOUR, 5 * HOUR);
    ids.justBooked = await book(5 * HOUR, 0);
    const cancelled = await book(4 * HOUR, 5 * HOUR);
    await tx.appointment.update({
      where: { id: cancelled },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    ids.cancelled = cancelled;
    ids.invoice = (
      await tx.invoice.create({ data: { ...A, clientId: ids.client, number: 'R6J-1' } })
    ).id;
  });
  await runInScope(db, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const c = await tx.client.create({ data: { ...B, displayName: 'B Client (fake)' } });
    ids.clientB = c.id;
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.primaryB.id,
        clientId: c.id,
        email: people.primaryB.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
    });
    ids.dueB = (
      await tx.appointment.create({
        data: {
          ...B,
          clientId: c.id,
          staffUserId: people.ownerB.id,
          startsAt: new Date(now + 3 * HOUR),
          endsAt: new Date(now + 3.5 * HOUR),
          locationKind: 'PHONE',
          createdAt: new Date(now - 5 * HOUR),
        },
      })
    ).id;
  });
  // The client's own private notes (only its owner may make a reminder).
  await runInScope(
    db,
    { kind: 'business', businessId: ids.firm, actorUserId: people.primary.id },
    async (tx) => {
      const remind = async (at: number) => {
        const note = await tx.clientPrivateNote.create({
          data: { businessId: ids.firm, userId: people.primary.id, body: 'Secret note text' },
        });
        return (
          await tx.clientNoteReminder.create({
            data: {
              businessId: ids.firm,
              noteId: note.id,
              userId: people.primary.id,
              remindAt: new Date(now + at),
            },
          })
        ).id;
      };
      ids.noteDue = await remind(-60_000);
      ids.noteLater = await remind(HOUR);
    },
  );
  await db.$disconnect();
  only.businessIds = [ids.firm];

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: async (message: NotifyMessage) => {
        await delivery.during?.();
        if (delivery.failing) {
          const error = new Error('provider down');
          error.name = 'NotifyDeliveryError';
          throw error;
        }
        outbox.push(message);
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  jobs = nest.get(ReminderJobs);
  notifier = nest.get(Notifier);
});

afterAll(async () => {
  await app?.close();
});

describe('reminder jobs', () => {
  it('are off in tests unless started', () => {
    expect(app.get<NotifyConfig>(NOTIFY_CONFIG).jobs).toBe(false);
  });

  it('appointment reminders: a due appointment once (bell on both sides, the email copy)', async () => {
    outbox.length = 0;
    expect(await jobs.run('appointment-reminders', only)).toEqual({ skipped: false, sent: 1 });
    for (const who of [people.primary, people.staff, people.owner]) {
      expect(await bell(who, ids.due)).toHaveLength(1);
    }
    expect(await bell(people.other, ids.due)).toEqual([]);
    expect(outbox.map((m) => [m.template, m.to])).toEqual([
      ['appointment.reminder', people.primary.email],
    ]);
    expect((await appointment(ids.due)).reminderSentAt).not.toBeNull();
    for (const id of [ids.far, ids.justBooked, ids.cancelled]) {
      expect((await appointment(id)).reminderSentAt).toBeNull();
      expect(await bell(people.owner, id)).toEqual([]);
    }
    // Firm B was not in this run, and is never touched by firm A's.
    expect((await appointment(ids.dueB, ids.firmB)).reminderSentAt).toBeNull();

    // A second run sends nothing more.
    outbox.length = 0;
    expect(await jobs.run('appointment-reminders', only)).toEqual({ skipped: false, sent: 0 });
    expect(outbox).toEqual([]);
    expect(await bell(people.primary, ids.due)).toHaveLength(1);
  });

  it('a rescheduled appointment gets a reminder for its new time', async () => {
    const startsAt = new Date(Date.now() + 10 * HOUR);
    await inFirm(ids.firm, (tx) =>
      tx.appointment.update({
        where: { id: ids.due },
        data: { startsAt, endsAt: new Date(startsAt.getTime() + HOUR / 2) },
      }),
    );
    expect((await appointment(ids.due)).reminderSentAt).toBeNull();
    // Not right after the change (its own email just went out).
    expect(await jobs.run('appointment-reminders', only)).toEqual({ skipped: false, sent: 0 });
    // Later on: reminded again, for the new time.
    outbox.length = 0;
    const later = { ...only, now: new Date(Date.now() + 3 * HOUR) };
    // (The appointment booked "just now" is past its quiet time by then too.)
    expect(await jobs.run('appointment-reminders', later)).toEqual({ skipped: false, sent: 2 });
    expect(await bell(people.primary, ids.due)).toHaveLength(2);
    expect(await bell(people.primary, ids.justBooked)).toHaveLength(1);
    expect(outbox.map((m) => m.template)).toEqual(['appointment.reminder', 'appointment.reminder']);
  });

  it("a run over both firms: each firm's reminder reaches only its own people", async () => {
    const firmAPeople = [people.owner, people.staff, people.other, people.primary].map((p) => p.id);
    const firmABefore = await inFirm(ids.firm, (tx) =>
      tx.notification.count({ where: { businessId: ids.firm } }),
    );
    outbox.length = 0;
    expect(await jobs.run('appointment-reminders', { businessIds: [ids.firm, ids.firmB] })).toEqual(
      { skipped: false, sent: 1 },
    );
    expect((await appointment(ids.dueB, ids.firmB)).reminderSentAt).not.toBeNull();
    const inB = await inFirm(ids.firmB, (tx) =>
      tx.notification.findMany({ where: { businessId: ids.firmB, entityId: ids.dueB } }),
    );
    expect(inB.map((n) => n.recipientUserId).sort()).toEqual(
      [people.ownerB.id, people.primaryB.id].sort(),
    );
    // Firm A's people get nothing of firm B's, and firm B's people nothing of firm A's.
    expect(
      await inFirm(ids.firmB, (tx) =>
        tx.notification.findMany({
          where: { businessId: ids.firmB, recipientUserId: { in: firmAPeople } },
        }),
      ),
    ).toEqual([]);
    expect(
      await inFirm(ids.firm, (tx) =>
        tx.notification.findMany({
          where: {
            businessId: ids.firm,
            OR: [
              { entityId: ids.dueB },
              { recipientUserId: { in: [people.ownerB.id, people.primaryB.id] } },
            ],
          },
        }),
      ),
    ).toEqual([]);
    expect(
      await inFirm(ids.firm, (tx) => tx.notification.count({ where: { businessId: ids.firm } })),
    ).toBe(firmABefore);
    expect(outbox.map((m) => [m.template, m.to, m.businessId])).toEqual([
      ['appointment.reminder', people.primaryB.email, ids.firmB],
    ]);
  });

  it('a reminder whose notify() fails waits REMINDER_BACKOFF_MS, so it never holds up the rest', async () => {
    const now = Date.now();
    const id = await inFirm(ids.firm, async (tx) => {
      const a = await tx.appointment.create({
        data: {
          businessId: ids.firm,
          clientId: ids.client,
          staffUserId: people.staff.id,
          startsAt: new Date(now + 2 * HOUR),
          endsAt: new Date(now + 2.5 * HOUR),
          locationKind: 'PHONE',
          createdAt: new Date(now - 5 * HOUR),
        },
      });
      return a.id;
    });
    const spy = vi.spyOn(notifier, 'notify').mockResolvedValueOnce({ written: 0, failed: true });
    try {
      const at = (ms: number) => ({ ...only, now: new Date(now + ms) });
      expect(await jobs.run('appointment-reminders', at(0))).toEqual({ skipped: false, sent: 0 });
      expect(spy).toHaveBeenCalledTimes(1);
      // Left out of the next runs while it backs off.
      expect(await jobs.run('appointment-reminders', at(60_000))).toEqual({
        skipped: false,
        sent: 0,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await appointment(id)).reminderSentAt).toBeNull();
      // Then tried again, and sent.
      expect(await jobs.run('appointment-reminders', at(REMINDER_BACKOFF_MS + 1_000))).toEqual({
        skipped: false,
        sent: 1,
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect((await appointment(id)).reminderSentAt).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("note reminders: a due reminder once, to the note's owner only", async () => {
    outbox.length = 0;
    expect(await jobs.run('note-reminders', only)).toEqual({ skipped: false, sent: 1 });
    const [item] = await bell(people.primary, ids.noteDue);
    expect(item).toMatchObject({ type: 'client_note.reminder', payload: {} });
    for (const who of [people.owner, people.staff]) {
      expect(await bell(who, ids.noteDue)).toEqual([]);
    }
    expect(await bell(people.primary, ids.noteLater)).toEqual([]);
    expect(outbox).toEqual([]);
    const marked = await inFirm(
      ids.firm,
      (tx) =>
        tx.clientNoteReminder.findMany({ where: { id: { in: [ids.noteDue, ids.noteLater] } } }),
      people.primary.id,
    );
    expect(marked.find((r) => r.id === ids.noteDue)?.remindedAt).not.toBeNull();
    expect(marked.find((r) => r.id === ids.noteLater)?.remindedAt).toBeNull();
    expect(await jobs.run('note-reminders', only)).toEqual({ skipped: false, sent: 0 });
    expect(await bell(people.primary, ids.noteDue)).toHaveLength(1);
  });

  it('a second runner skips while another task holds the lock (q30)', async () => {
    const db = owner();
    try {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holder = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${JOB_LOCK_KEYS['appointment-reminders']}::bigint)::text AS held`;
          locked();
          await released;
        },
        { timeout: 30_000 },
      );
      await isLocked;
      expect(await jobs.run('appointment-reminders', only)).toEqual({ skipped: true });
      // The other job has its own lock.
      expect(await jobs.run('note-reminders', only)).toEqual({ skipped: false, sent: 0 });
      release();
      await holder;
      expect(await jobs.run('appointment-reminders', only)).toEqual({ skipped: false, sent: 0 });
    } finally {
      await db.$disconnect();
    }
  });

  it('the outbox: a failed email copy is FAILED, retried by the job, then SENT once', async () => {
    const deliveries = () =>
      inFirm(ids.firm, (tx) =>
        tx.notificationDelivery.findMany({
          where: { notification: { entityId: ids.invoice } },
        }),
      );
    outbox.length = 0;
    delivery.failing = true;
    expect(
      await notifier.notify({ businessId: ids.firm, event: 'invoice.sent', recordId: ids.invoice }),
    ).toEqual({ written: 1 });
    const [first] = await deliveries();
    expect(first).toMatchObject({
      channel: 'EMAIL',
      status: 'FAILED',
      attempts: 1,
      lastError: 'NotifyDeliveryError',
      sentAt: null,
    });
    // Not before EMAIL_RETRY_AFTER_MS.
    expect(await jobs.run('email-retries', only)).toEqual({ skipped: false, sent: 0 });
    expect((await deliveries())[0]?.attempts).toBe(1);
    const later = (ms: number) => ({ ...only, now: new Date(Date.now() + ms) });
    // Still failing: one more attempt.
    await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS + 1_000));
    expect((await deliveries())[0]).toMatchObject({ status: 'FAILED', attempts: 2 });
    // A stale claim (another task took it first) does nothing.
    expect(await notifier.retryDelivery(ids.firm, first!.id, 1)).toBe('busy');
    // The provider is back: SENT, with the same email as the first try would have sent.
    delivery.failing = false;
    expect(await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS + 1_000))).toEqual({
      skipped: false,
      sent: 1,
    });
    const [sent] = await deliveries();
    expect(sent).toMatchObject({ status: 'SENT', attempts: 3, lastError: null });
    expect(sent?.sentAt).not.toBeNull();
    expect(outbox.map((m) => [m.template, m.to, m.data])).toEqual([
      [
        'invoice.sent',
        people.primary.email,
        expect.objectContaining({ name: people.primary.name, invoiceNumber: 'R6J-1' }),
      ],
    ]);
    // Final: never sent again.
    await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS * 3));
    expect(outbox).toHaveLength(1);
  });

  it(`the outbox gives up after ${EMAIL_MAX_ATTEMPTS} attempts`, async () => {
    delivery.failing = true;
    try {
      const invoice = await inFirm(ids.firm, (tx) =>
        tx.invoice.create({
          data: { businessId: ids.firm, clientId: ids.client, number: 'R6J-2' },
        }),
      );
      await notifier.notify({ businessId: ids.firm, event: 'invoice.sent', recordId: invoice.id });
      for (let i = 1; i <= EMAIL_MAX_ATTEMPTS + 1; i += 1) {
        await jobs.run('email-retries', {
          ...only,
          now: new Date(Date.now() + i * (EMAIL_RETRY_AFTER_MS + 1_000)),
        });
      }
      const [row] = await inFirm(ids.firm, (tx) =>
        tx.notificationDelivery.findMany({ where: { notification: { entityId: invoice.id } } }),
      );
      expect(row).toMatchObject({ status: 'FAILED', attempts: EMAIL_MAX_ATTEMPTS });
    } finally {
      delivery.failing = false;
    }
  });

  const later = (ms: number, businessIds = only.businessIds) => ({
    businessIds,
    now: new Date(Date.now() + ms),
  });
  const deliveriesOf = (entityId: string, businessId = ids.firm) =>
    inFirm(businessId, (tx) =>
      tx.notificationDelivery.findMany({ where: { businessId, notification: { entityId } } }),
    );

  it("the outbox is per firm: firm A's run and retry never touch firm B's delivery", async () => {
    const invoiceB = await inFirm(ids.firmB, (tx) =>
      tx.invoice.create({
        data: { businessId: ids.firmB, clientId: ids.clientB, number: 'R6J-B1' },
      }),
    );
    delivery.failing = true;
    try {
      await notifier.notify({
        businessId: ids.firmB,
        event: 'invoice.sent',
        recordId: invoiceB.id,
      });
    } finally {
      delivery.failing = false;
    }
    const [failed] = await deliveriesOf(invoiceB.id, ids.firmB);
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1 });
    outbox.length = 0;
    // Firm A's run, after the retry wait: firm B's row is untouched.
    expect(await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS + 1_000))).toEqual({
      skipped: false,
      sent: 0,
    });
    // A retry in firm A's scope with firm B's delivery id does nothing.
    expect(await notifier.retryDelivery(ids.firm, failed!.id, 1)).toBe('busy');
    expect(await deliveriesOf(invoiceB.id, ids.firmB)).toEqual([failed]);
    expect(outbox).toEqual([]);
    // Firm B's own run sends it, to firm B's client.
    expect(
      await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS + 1_000, [ids.firmB])),
    ).toEqual({ skipped: false, sent: 1 });
    expect((await deliveriesOf(invoiceB.id, ids.firmB))[0]).toMatchObject({
      status: 'SENT',
      attempts: 2,
    });
    expect(outbox.map((m) => [m.template, m.to, m.businessId])).toEqual([
      ['invoice.sent', people.primaryB.email, ids.firmB],
    ]);
  });

  it('a retry is SKIPPED when its record no longer stands (cancelled, moved, started, canceled invoice)', async () => {
    const now = Date.now();
    const book = (hours: number) =>
      inFirm(ids.firm, (tx) =>
        tx.appointment.create({
          data: {
            businessId: ids.firm,
            clientId: ids.client,
            staffUserId: people.staff.id,
            startsAt: new Date(now + hours * HOUR),
            endsAt: new Date(now + (hours + 0.5) * HOUR),
            locationKind: 'PHONE',
          },
        }),
      );
    const [cancelled, moved, kept] = [await book(48), await book(49), await book(51)];
    // Booked a while ago, starting soon: its copy fails now, and it has started by the retry.
    const started = await book(0.001);
    const invoice = await inFirm(ids.firm, (tx) =>
      tx.invoice.create({ data: { businessId: ids.firm, clientId: ids.client, number: 'R6J-3' } }),
    );
    delivery.failing = true;
    try {
      for (const a of [cancelled, moved, kept, started]) {
        await notifier.notify({
          businessId: ids.firm,
          event: 'appointment.booked',
          recordId: a.id,
        });
      }
      await notifier.notify({ businessId: ids.firm, event: 'invoice.sent', recordId: invoice.id });
    } finally {
      delivery.failing = false;
    }
    await inFirm(ids.firm, async (tx) => {
      await tx.appointment.update({
        where: { id: cancelled.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await tx.appointment.update({
        where: { id: moved.id },
        data: { startsAt: new Date(now + 53 * HOUR), endsAt: new Date(now + 53.5 * HOUR) },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
    });
    while (Date.now() <= now + 0.001 * HOUR) await new Promise((r) => setTimeout(r, 50));
    outbox.length = 0;
    expect(await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS + 1_000))).toEqual({
      skipped: false,
      sent: 1,
    });
    for (const id of [cancelled.id, moved.id, invoice.id, started.id]) {
      expect((await deliveriesOf(id))[0]).toMatchObject({
        status: 'SKIPPED',
        attempts: 2,
        sentAt: null,
        lastError: null,
      });
    }
    expect((await deliveriesOf(kept.id))[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(outbox.map((m) => [m.template, m.to])).toEqual([
      ['appointment.booked', people.primary.email],
    ]);
    // SKIPPED is final.
    await jobs.run('email-retries', later(EMAIL_RETRY_AFTER_MS * 3));
    expect(outbox).toHaveLength(1);
  });

  it('a retry is SKIPPED when the login is no longer the PRIMARY one', async () => {
    const invoice = await inFirm(ids.firm, (tx) =>
      tx.invoice.create({ data: { businessId: ids.firm, clientId: ids.client, number: 'R6J-4' } }),
    );
    delivery.failing = true;
    try {
      await notifier.notify({ businessId: ids.firm, event: 'invoice.sent', recordId: invoice.id });
    } finally {
      delivery.failing = false;
    }
    const role = (portalRole: 'PRIMARY' | 'SPOUSE') =>
      inFirm(ids.firm, (tx) =>
        tx.clientAccount.updateMany({
          where: { businessId: ids.firm, userId: people.primary.id },
          data: { portalRole },
        }),
      );
    await role('SPOUSE');
    try {
      outbox.length = 0;
      const [row] = await deliveriesOf(invoice.id);
      expect(await notifier.retryDelivery(ids.firm, row!.id, 1)).toBe('skipped');
      expect((await deliveriesOf(invoice.id))[0]).toMatchObject({ status: 'SKIPPED' });
      expect(outbox).toEqual([]);
    } finally {
      await role('PRIMARY');
    }
  });

  it("a slow attempt never overwrites a later claim's outcome", async () => {
    const invoice = await inFirm(ids.firm, (tx) =>
      tx.invoice.create({ data: { businessId: ids.firm, clientId: ids.client, number: 'R6J-5' } }),
    );
    delivery.failing = true;
    try {
      await notifier.notify({ businessId: ids.firm, event: 'invoice.sent', recordId: invoice.id });
    } finally {
      delivery.failing = false;
    }
    const [row] = await deliveriesOf(invoice.id);
    // While this attempt sends, another task claims the delivery again (attempts 2 -> 3).
    delivery.during = async () => {
      delivery.during = undefined;
      await inFirm(ids.firm, (tx) =>
        tx.notificationDelivery.update({ where: { id: row!.id }, data: { attempts: 3 } }),
      );
    };
    try {
      await notifier.retryDelivery(ids.firm, row!.id, 1);
    } finally {
      delivery.during = undefined;
    }
    // The later claim decides: this attempt's SENT is not written over it.
    expect((await deliveriesOf(invoice.id))[0]).toMatchObject({
      status: 'FAILED',
      attempts: 3,
      sentAt: null,
    });
  });
});

// Tax Planning Review 2 (Project Deadlines): each due reminder once per due time, to the owner and
// the coworkers it is shared with (ACTIVE members only), in-app and by email as it says.
describe('project deadline reminders', () => {
  const gone = person('gone', 'STAFF');
  const pd = { service: '', shared: '', done: '', past: '', priv: '' };
  const r = { shared: '', soonLater: '', done: '', past: '', priv: '' };

  const deadline = (businessId: string, data: Record<string, unknown>) =>
    inFirm(businessId, (tx) =>
      tx.projectDeadline.create({
        data: {
          businessId,
          name: `Fake deadline ${randomUUID().slice(0, 6)}`,
          serviceId: pd.service,
          ownerUserId: people.owner.id,
          ...data,
        } as never,
        select: { id: true },
      }),
    ).then((d) => d.id);
  const reminder = (
    businessId: string,
    deadlineId: string,
    minutesBefore: number,
    email: boolean,
  ) =>
    inFirm(businessId, (tx) =>
      tx.projectDeadlineReminder.create({
        data: {
          businessId,
          deadlineId,
          minutesBefore,
          unit: 'MINUTES',
          channels: email ? ['EMAIL'] : [],
        },
        select: { id: true },
      }),
    ).then((x) => x.id);
  const sentAt = (id: string, businessId = ids.firm) =>
    inFirm(businessId, (tx) =>
      tx.projectDeadlineReminder.findUnique({ where: { id }, select: { sentAt: true } }),
    ).then((x) => x?.sentAt ?? null);

  beforeAll(async () => {
    const now = Date.now();
    const db = owner();
    try {
      await runInScope(db, { kind: 'platform' }, (tx) =>
        tx.user.create({
          data: {
            id: gone.id,
            cognitoSub: gone.id,
            pool: 'STAFF',
            email: gone.email,
            name: gone.name,
          },
        }),
      );
    } finally {
      await db.$disconnect();
    }
    await inFirm(ids.firm, (tx) =>
      tx.membership.create({
        data: { businessId: ids.firm, userId: gone.id, role: 'STAFF', status: 'DEACTIVATED' },
      }),
    );
    pd.service = await inFirm(ids.firm, (tx) =>
      tx.service.create({
        data: { businessId: ids.firm, kind: 'TAX_PLANNING', name: `Planning ${run}` },
        select: { id: true },
      }),
    ).then((s) => s.id);
    const inTwoHours = new Date(now + 2 * HOUR);
    // Shared with Staff (assigned to the client), Other (not assigned) and Gone (deactivated).
    pd.shared = await deadline(ids.firm, {
      dueAt: inTwoHours,
      clientId: ids.client,
      visibility: 'SHARED',
    });
    await inFirm(ids.firm, (tx) =>
      tx.projectDeadlineShare.createMany({
        data: [people.staff, people.other, gone].map((m) => ({
          businessId: ids.firm,
          deadlineId: pd.shared,
          userId: m.id,
        })),
      }),
    );
    r.shared = await reminder(ids.firm, pd.shared, 180, true);
    r.soonLater = await reminder(ids.firm, pd.shared, 60, true);
    pd.done = await deadline(ids.firm, {
      dueAt: inTwoHours,
      completedAt: new Date(),
      completedByUserId: people.owner.id,
    });
    r.done = await reminder(ids.firm, pd.done, 180, true);
    pd.past = await deadline(ids.firm, { dueAt: new Date(now - 2 * HOUR) });
    r.past = await reminder(ids.firm, pd.past, 180, true);
    // The Staff member's own private deadline: a bell item only.
    pd.priv = await deadline(ids.firm, { dueAt: inTwoHours, ownerUserId: people.staff.id });
    r.priv = await reminder(ids.firm, pd.priv, 180, false);
  });

  it('a due reminder goes once to the owner and the coworkers, never to a deactivated member', async () => {
    outbox.length = 0;
    expect(await jobs.run('project-deadline-reminders', only)).toEqual({
      skipped: false,
      sent: 2,
    });
    for (const who of [people.owner, people.staff, people.other]) {
      const items = await bell(who, pd.shared);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'project_deadline.reminder',
        entityType: 'project_deadline',
        category: 'SERVICES',
      });
      // The client is never named, whoever it reaches.
      expect(JSON.stringify(items[0]?.payload)).not.toContain('Jamie');
    }
    expect(await bell(gone, pd.shared)).toEqual([]);
    expect(await bell(people.primary, pd.shared)).toEqual([]);
    // The email copies: the three members, to their own addresses, linking to the firm app.
    const mails = outbox.filter((m) => m.template === 'project-deadline.reminder');
    expect(mails.map((m) => m.to).sort()).toEqual(
      [people.owner.email, people.staff.email, people.other.email].sort(),
    );
    const data = mails[0]?.data as { link: string };
    expect(data.link).toMatch(/\/tax-planning\/deadlines$/);
    // The private one: its owner's bell only, no email.
    expect(await bell(people.staff, pd.priv)).toHaveLength(1);
    expect(await bell(people.owner, pd.priv)).toEqual([]);
    expect(outbox.filter((m) => m.to === people.staff.email)).toHaveLength(1);

    expect(await sentAt(r.shared)).not.toBeNull();
    expect(await sentAt(r.priv)).not.toBeNull();
    // Not yet due, completed, or past by more than an hour: nothing sent, nothing marked.
    for (const id of [r.soonLater, r.done, r.past]) expect(await sentAt(id)).toBeNull();
    expect(await bell(people.owner, pd.done)).toEqual([]);
    expect(await bell(people.owner, pd.past)).toEqual([]);

    // Once: a second run sends nothing more.
    expect(await jobs.run('project-deadline-reminders', only)).toEqual({ skipped: false, sent: 0 });
    expect(await bell(people.owner, pd.shared)).toHaveLength(1);
  });

  it('the later reminder goes at its own time; a new due time gets its reminders again', async () => {
    outbox.length = 0;
    const later = new Date(Date.now() + HOUR + 60_000);
    expect(await jobs.run('project-deadline-reminders', { ...only, now: later })).toEqual({
      skipped: false,
      sent: 1,
    });
    expect(await bell(people.owner, pd.shared)).toHaveLength(2);
    // The due time moves (the API clears sent_at then): the first reminder goes again.
    const moved = new Date(Date.now() + 3 * HOUR);
    await inFirm(ids.firm, async (tx) => {
      await tx.projectDeadline.update({ where: { id: pd.shared }, data: { dueAt: moved } });
      await tx.projectDeadlineReminder.updateMany({
        where: { deadlineId: pd.shared },
        data: { sentAt: null },
      });
    });
    expect(await jobs.run('project-deadline-reminders', only)).toEqual({ skipped: false, sent: 1 });
    expect(await bell(people.owner, pd.shared)).toHaveLength(3);
    expect(await sentAt(r.soonLater)).toBeNull();
  });

  it('a member’s email copy that fails is retried from the outbox to their own address', async () => {
    outbox.length = 0;
    const d = await deadline(ids.firm, { dueAt: new Date(Date.now() + 2 * HOUR) });
    await reminder(ids.firm, d, 180, true);
    delivery.failing = true;
    try {
      expect(await jobs.run('project-deadline-reminders', only)).toEqual({
        skipped: false,
        sent: 1,
      });
    } finally {
      delivery.failing = false;
    }
    const failed = await inFirm(ids.firm, (tx) =>
      tx.notificationDelivery.findMany({ where: { notification: { entityId: d } } }),
    );
    expect(failed.map((x) => x.status)).toEqual(['FAILED']);
    expect(await notifier.retryDelivery(ids.firm, failed[0]!.id, failed[0]!.attempts)).toBe('sent');
    expect(outbox.map((m) => [m.template, m.to])).toEqual([
      ['project-deadline.reminder', people.owner.email],
    ]);
  });

  it("firm A's run never touches firm B's reminders", async () => {
    const serviceB = await inFirm(ids.firmB, (tx) =>
      tx.service.create({
        data: { businessId: ids.firmB, kind: 'TAX_PLANNING', name: `Planning B ${run}` },
        select: { id: true },
      }),
    ).then((s) => s.id);
    const b = await inFirm(ids.firmB, (tx) =>
      tx.projectDeadline.create({
        data: {
          businessId: ids.firmB,
          name: 'Fake B deadline',
          dueAt: new Date(Date.now() + 2 * HOUR),
          serviceId: serviceB,
          ownerUserId: people.ownerB.id,
        },
        select: { id: true },
      }),
    ).then((x) => x.id);
    const rb = await reminder(ids.firmB, b, 180, true);
    await jobs.run('project-deadline-reminders', only);
    expect(await sentAt(rb, ids.firmB)).toBeNull();
    expect(await bell(people.ownerB, b, ids.firmB)).toEqual([]);
  });
});
