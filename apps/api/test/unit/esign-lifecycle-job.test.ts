// R13 step 8, the lifecycle job on the in-memory ports (esign-fakes.ts): automatic reminders on
// the request's schedule (at most `max`, a manual one counting), the once-only expiry warning,
// expiry with the sender's update, the job lock, firm-by-firm runs that never touch another firm,
// a lost write and a failing request, and ESIGN_JOBS. Synthetic data only.
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
import { EsignLifecycleJob, esignJobsOn } from '../../src/esign/lifecycle/lifecycle.job.js';
import { EsignLifecycleService } from '../../src/esign/lifecycle/lifecycle.service.js';
import type { EsignRecipientRecord } from '../../src/esign/requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  FakeNotify,
  InMemoryLifecycleRepository,
  sentRecipient,
} from './esign-fakes.js';

const APP = 'https://app.example.test';
const DAY = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let w: EsignWorld;
let notify: FakeNotify;
let lc: InMemoryLifecycleRepository;
let requests: EsignRequestsService;
let svc: EsignLifecycleService;
let job: EsignLifecycleJob;
let now: number;

beforeEach(() => {
  w = esignWorld();
  notify = new FakeNotify();
  lc = new InMemoryLifecycleRepository(w.repo);
  lc.firmIds.push(w.a, w.b);
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  svc = new EsignLifecycleService(
    requests,
    w.repo,
    lc,
    w.directory,
    w.store,
    new RandomLinkTokens(),
    notify,
    w.audit,
    { PORTAL_BASE_URL: 'https://portal.example.test', APP_BASE_URL: APP },
  );
  job = new EsignLifecycleJob(lc, w.repo, w.directory, svc, w.audit, { APP_BASE_URL: APP });
  now = Date.now();
});
afterEach(() => vi.restoreAllMocks());

const at = (days: number) => ({ now: new Date(now + days * DAY) });

/** A request SENT `sentDaysAgo` days ago (expiring 30 days after), in firm A unless `firm`. */
async function sentRequest(
  sentDaysAgo: number,
  recipients: (w: EsignWorld) => EsignRecipientRecord[] = (x) => [sentRecipient(x)],
  firm: 'a' | 'b' = 'a',
) {
  const businessId = firm === 'a' ? w.a : w.b;
  const actor: EsignActor = {
    userId: firm === 'a' ? w.users.ownerA : w.users.ownerB,
    role: 'OWNER',
  };
  const clientId = firm === 'a' ? w.ids.c1 : w.ids.cB;
  const { id } = await requests.create(businessId, actor, {
    title: 'Fake letter',
    source: 'TAB',
    clientId,
  });
  const sentAt = new Date(now - sentDaysAgo * DAY);
  const rs = recipients(w).map((r) => ({ ...r, sentAt: r.sentAt && sentAt }));
  w.repo.seed(businessId, id, (row) => {
    Object.assign(row.record, {
      status: 'SENT',
      sentAt,
      expiresAt: new Date(+sentAt + 30 * DAY),
      lastActivityAt: sentAt,
    });
    row.parts.recipients = rs;
  });
  return { id, businessId, recipients: rs };
}

const timeline = async (businessId: string, id: string) =>
  (await w.repo.events(businessId, id)).map((e) => [e.type, e.actorKind, e.actorName]);

describe('automatic reminders', () => {
  it('reminds a signer firstAfterDays after sending, then every everyDays, at most max', async () => {
    const { id, recipients } = await sentRequest(2);
    expect(await job.run(at(0))).toEqual({ skipped: false, expired: 0, warned: 0, reminded: 0 });
    expect(await job.run(at(1))).toMatchObject({ reminded: 1 });
    expect(await job.run(at(1))).toMatchObject({ reminded: 0 });
    expect(await job.run(at(4))).toMatchObject({ reminded: 1 });
    expect(await job.run(at(7))).toMatchObject({ reminded: 1 });
    expect(await job.run(at(10))).toMatchObject({ reminded: 0 }); // max 3
    expect(await timeline(w.a, id)).toEqual(
      Array.from({ length: 3 }, () => ['REMINDER_SENT', 'SYSTEM', 'Firmivra']),
    );
    expect(notify.sent.map((m) => [m.template, m.to])).toEqual(
      Array.from({ length: 3 }, () => ['esign.reminder', 'primary@client.test']),
    );
    const token = (notify.sent[2]!.data as { link: string }).link.split('#t=')[1]!;
    expect(lc.findLink(w.a, sha(token))).toBe(recipients[0]!.id);
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.request_reminded',
      entity: { type: 'esign_request', id },
      metadata: {
        clientId: w.ids.c1,
        recipientIds: [recipients[0]!.id],
        emailIds: [[...w.repo.outbox.of(w.a).keys()][2]],
      },
      at: { businessId: w.a },
    });
    expect(JSON.stringify(w.audit.entries)).not.toContain(token);
  });

  it('counts a manual reminder and waits everyDays after it', async () => {
    const { id } = await sentRequest(4);
    await svc.remind(w.a, { userId: w.users.ownerA, role: 'OWNER' }, id);
    expect(await job.run(at(0))).toMatchObject({ reminded: 0 });
    expect(await job.run(at(2.9))).toMatchObject({ reminded: 0 });
    expect(await job.run(at(3.1))).toMatchObject({ reminded: 1 });
    const [r] = (await w.repo.parts(w.a, id)).recipients;
    expect(r!.reminderCount).toBe(2);
  });

  it('reminds no one not in turn, IN_PERSON, or when the firm set max to 0', async () => {
    await sentRequest(10, (x) => [
      sentRecipient(x, { status: 'WAITING', sentAt: null }),
      sentRecipient(x, { delivery: 'IN_PERSON' }),
      sentRecipient(x, { status: 'SIGNED' }),
    ]);
    const off = await sentRequest(10);
    w.repo.seed(w.a, off.id, (row) => (row.record.reminders.max = 0));
    expect(await job.run(at(0))).toMatchObject({ reminded: 0 });
    expect(notify.sent).toHaveLength(0);
  });
});

describe('expiry warning and expiry', () => {
  it('warns the signers in turn once, expiryWarningDays before the expiry', async () => {
    const { id } = await sentRequest(27, (x) => [
      sentRecipient(x, { lastRemindedAt: new Date(now), reminderCount: 3 }),
    ]);
    expect(await job.run(at(0))).toMatchObject({ warned: 0 });
    expect(await job.run(at(1.5))).toMatchObject({ warned: 1 });
    expect(await job.run(at(2))).toMatchObject({ warned: 0 });
    const [message] = notify.sent;
    expect([message?.template, message?.to]).toEqual(['esign.expiring', 'primary@client.test']);
    const q = (await w.repo.findRequest(w.a, id))!;
    expect((message?.data as { expiresAt: Date }).expiresAt).toEqual(q.expiresAt);
    expect(q.expiryWarnedAt).toEqual(at(1.5).now);
    expect(await timeline(w.a, id)).toEqual([['EXPIRY_WARNING_SENT', 'SYSTEM', 'Firmivra']]);
    expect(w.audit.entries.at(-1)).toMatchObject({ action: 'esign.request_expiry_warned' });
  });

  it('expires an open request, tells the sender and closes its links', async () => {
    const { id, recipients } = await sentRequest(31);
    lc.links
      .of(w.a)
      .set('old-hash', { requestId: id, recipientId: recipients[0]!.id, tokenVersion: 0 });
    expect(await job.run(at(0))).toMatchObject({ expired: 1 });
    const q = (await w.repo.findRequest(w.a, id))!;
    expect([q.status, q.expiredAt]).toEqual(['EXPIRED', at(0).now]);
    const detail = await requests.answer(w.a, q);
    expect([detail.expiredAt, detail.allowedActions]).toEqual([
      at(0).now.toISOString(),
      ['DOWNLOAD'],
    ]);
    expect(lc.findLink(w.a, 'old-hash')).toBeNull();
    expect(await timeline(w.a, id)).toEqual([['EXPIRED', 'SYSTEM', 'Firmivra']]);
    expect(notify.sent).toEqual([
      {
        template: 'esign.staff-update',
        to: 'owner-a@firm.test',
        businessId: w.a,
        recipient: { userId: w.users.ownerA },
        data: {
          name: 'owner-a',
          title: 'Fake letter',
          event: 'EXPIRED',
          link: `${APP}/firm-sign/requests/${id}`,
        },
      },
    ]);
    expect([...w.repo.outbox.of(w.a).values()]).toEqual([
      { userId: w.users.ownerA, template: 'esign.staff-update', status: 'SENT', error: null },
    ]);
    expect(w.audit.entries.at(-1)).toMatchObject({
      action: 'esign.request_expired',
      metadata: { clientId: w.ids.c1 },
      at: { businessId: w.a },
    });
    expect(await job.run(at(1))).toMatchObject({ expired: 0 });
  });

  it('never expires a request whose signers all signed (its completion is pending)', async () => {
    const { id } = await sentRequest(31, (x) => [sentRecipient(x, { status: 'SIGNED' })]);
    w.repo.seed(w.a, id, (row) => (row.record.status = 'PARTIALLY_SIGNED'));
    expect(await job.run(at(0))).toMatchObject({ expired: 0 });
    expect((await w.repo.findRequest(w.a, id))!.status).toBe('PARTIALLY_SIGNED');
  });

  it('writes nothing when it loses to another write; tries again next run', async () => {
    await sentRequest(31);
    vi.spyOn(lc, 'expire').mockResolvedValueOnce(null);
    expect(await job.run(at(0))).toMatchObject({ expired: 0 });
    expect([
      notify.sent.length,
      w.audit.entries.filter((e) => e.action === 'esign.request_expired').length,
    ]).toEqual([0, 0]);
    expect(await job.run(at(0))).toMatchObject({ expired: 1 });
  });
});

describe('the job run', () => {
  it('skips the run while another task holds the lock, changing nothing', async () => {
    const { id } = await sentRequest(31);
    lc.lockedElsewhere = true;
    expect(await job.run(at(0))).toEqual({ skipped: true });
    expect((await w.repo.findRequest(w.a, id))!.status).toBe('SENT');
    expect(notify.sent).toHaveLength(0);
  });

  it('works across firms, each in its own firm', async () => {
    const a = await sentRequest(31);
    const b = await sentRequest(31, undefined, 'b');
    expect(await job.run(at(0))).toMatchObject({ expired: 2 });
    expect((await w.repo.findRequest(w.a, a.id))!.status).toBe('EXPIRED');
    expect((await w.repo.findRequest(w.b, b.id))!.status).toBe('EXPIRED');
    expect(notify.sent.map((m) => [m.businessId, m.to])).toEqual([
      [w.a, 'owner-a@firm.test'],
      [w.b, 'owner-b@firm.test'],
    ]);
    const audits = w.audit.entries.filter((e) => e.action === 'esign.request_expired');
    expect(audits.map((e) => [e.entity.id, e.at])).toEqual([
      [a.id, { businessId: w.a }],
      [b.id, { businessId: w.b }],
    ]);
  });

  it('never touches firm B in firm A’s run', async () => {
    const a = await sentRequest(31);
    const b = await sentRequest(31, undefined, 'b');
    const before = structuredClone(await w.repo.findRequest(w.b, b.id));
    expect(await job.run({ ...at(0), businessIds: [w.a] })).toMatchObject({ expired: 1 });
    expect((await w.repo.findRequest(w.a, a.id))!.status).toBe('EXPIRED');
    expect(await w.repo.findRequest(w.b, b.id)).toEqual(before);
    expect([w.repo.outbox.of(w.b).size, (await w.repo.events(w.b, b.id)).length]).toEqual([0, 0]);
    expect(notify.sent.every((m) => m.businessId === w.a)).toBe(true);
    expect(w.audit.entries.some((e) => e.at?.businessId === w.b)).toBe(false);
  });

  it('goes on past a failing request, logging its id only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const bad = await sentRequest(31);
    const good = await sentRequest(31);
    const parts = w.repo.parts.bind(w.repo);
    vi.spyOn(w.repo, 'parts').mockImplementation((firm, id) =>
      id === bad.id ? Promise.reject(new TypeError('Fake failure')) : parts(firm, id),
    );
    expect(await job.run(at(0))).toMatchObject({ expired: 1 });
    expect((await w.repo.findRequest(w.a, good.id))!.status).toBe('EXPIRED');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(`request ${bad.id} failed (TypeError)`);
    expect(logged).not.toContain('Fake failure');
  });
});

describe('ESIGN_JOBS', () => {
  it('is off unless on, and refuses anything else', () => {
    expect(esignJobsOn({})).toBe(false);
    expect(esignJobsOn({ ESIGN_JOBS: 'off' })).toBe(false);
    expect(esignJobsOn({ ESIGN_JOBS: 'on' })).toBe(true);
    expect(() => esignJobsOn({ ESIGN_JOBS: 'yes' })).toThrow(/ESIGN_JOBS/);
  });

  it('starts no timer while off', () => {
    const timer = vi.spyOn(globalThis, 'setInterval');
    job.onApplicationBootstrap();
    expect(timer).not.toHaveBeenCalled();
    job.onModuleDestroy();
  });
});
