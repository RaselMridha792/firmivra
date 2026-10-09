// End-to-end: R6 step 7, the reminder jobs (appointment.reminder, client-note.reminder) under
// their advisory lock (q30), against the database. The jobs are off in tests (NOTIFY_JOBS); each
// test runs them by hand for its own firm only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
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
  noteDue: '',
  noteLater: '',
  invoice: '',
};

let app: INestApplication;
let jobs: ReminderJobs;
let notifier: Notifier;
const outbox: NotifyMessage[] = [];
/** Set to make the fake sender refuse every message. */
const delivery = { failing: false };
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
      send: (message: NotifyMessage) => {
        if (delivery.failing) {
          const error = new Error('provider down');
          error.name = 'NotifyDeliveryError';
          return Promise.reject(error);
        }
        outbox.push(message);
        return Promise.resolve();
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
});
