// R13 step 6, requests API part 1: status on the in-memory ports (esign-fakes.ts), and the
// fakes themselves, which part 1b's drafts, page plan and recipients tests build on: each firm
// sees only its own rows, and writes reach DRAFTs only. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import type { NewEsignRequest } from '../../src/esign/requests/esign.repository.js';
import { ESIGN_TEST_DEFAULTS, esignWorld, type EsignWorld } from './esign-fakes.js';

let w: EsignWorld;
let svc: EsignRequestsService;
let owner: EsignActor;
let staff: EsignActor;

beforeEach(() => {
  w = esignWorld();
  svc = new EsignRequestsService(w.modules);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
});

const input = (): NewEsignRequest => ({
  title: 'Engagement letter 2025',
  source: 'TAB',
  clientId: null,
  engagementId: null,
  senderUserId: w.users.ownerA,
  internalNote: null,
  emailSubject: null,
  emailMessage: ESIGN_TEST_DEFAULTS.emailMessage,
  routing: 'SEQUENTIAL',
  expiryDays: ESIGN_TEST_DEFAULTS.expiryDays,
  reminders: ESIGN_TEST_DEFAULTS.reminders,
  expiryWarningDays: ESIGN_TEST_DEFAULTS.expiryWarningDays,
});

describe('GET /esign/status', () => {
  it('says on with the caller’s role, and off (never an error) with no role', async () => {
    expect(await svc.status(w.a, owner)).toEqual({ enabled: true, myEsignRole: 'OWNER' });
    expect(await svc.status(w.a, staff)).toEqual({ enabled: true, myEsignRole: 'STAFF' });
    w.modules.set(w.a, 'esign', false);
    expect(await svc.status(w.a, owner)).toEqual({ enabled: false, myEsignRole: null });
    // One firm's switch is not another's.
    expect(await svc.status(w.b, { userId: w.users.ownerB, role: 'OWNER' })).toMatchObject({
      enabled: true,
    });
  });
});

describe('the in-memory fakes', () => {
  it('keeps each firm’s requests to itself', async () => {
    const made = await w.repo.createRequest(w.a, input());
    expect(made).toMatchObject({ status: 'DRAFT', title: 'Engagement letter 2025' });
    expect(await w.repo.findRequest(w.a, made.id)).toEqual(made);
    expect(await w.repo.findRequest(w.b, made.id)).toBeNull();
    expect(await w.repo.updateDraft(w.b, made.id, { title: 'x' })).toBe(false);
    expect(await w.repo.deleteDraft(w.b, made.id)).toBe(false);
    expect((await w.repo.parts(w.b, made.id)).documents).toEqual([]);
    expect((await w.repo.findRequest(w.a, made.id))?.title).toBe('Engagement letter 2025');
  });

  it('writes to DRAFTs only, and can lose one write to a send', async () => {
    const made = await w.repo.createRequest(w.a, input());
    expect(await w.repo.updateDraft(w.a, made.id, { title: 'Form 8879' })).toBe(true);
    w.repo.loseNextWrite = true;
    expect(await w.repo.updateDraft(w.a, made.id, { title: 'lost' })).toBe(false);
    w.repo.seed(w.a, made.id, (row) => (row.record.status = 'SENT'));
    expect(await w.repo.savePagePlan(w.a, made.id, [], [])).toBe(false);
    expect(await w.repo.saveRecipients(w.a, made.id, [], [])).toBe(false);
    expect(await w.repo.deleteDraft(w.a, made.id)).toBe(false);
    expect(await w.repo.findRequest(w.a, made.id)).toMatchObject({
      status: 'SENT',
      title: 'Form 8879',
    });
    expect(await w.repo.updateDraft(w.a, randomUUID(), { title: 'x' })).toBe(false);
  });

  it('answers the directory per firm', async () => {
    expect((await w.directory.client(w.a, w.ids.c1))?.displayName).toBe('Fake Client One');
    expect(await w.directory.client(w.b, w.ids.c1)).toBeNull();
    expect(await w.directory.engagement(w.b, w.ids.e1)).toBeNull();
    expect(await w.directory.clientLogin(w.b, w.ids.primary)).toBeNull();
    expect(await w.directory.member(w.b, w.users.ownerA)).toBeNull();
    expect((await w.directory.member(w.a, w.users.goneA))?.active).toBe(false);
  });
});
