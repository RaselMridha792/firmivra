// Automations, part 2 (R38): runs, action executions and settings. Isolation between firms,
// idempotency, and the rule that a succeeded action is never run again. Runs as the app role
// under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let ruleA: { id: string; version: string };
const A = () => db.forBusiness(f.firmA);

async function makeRule(firm: string, client = db.forBusiness(firm)) {
  const rule = await client.automationRule.create({
    data: { businessId: firm, name: `Rule ${randomUUID()}`, category: 'TASKS' },
  });
  const v = await client.automationRuleVersion.create({
    data: {
      businessId: firm,
      ruleId: rule.id,
      version: 1,
      triggerModule: 'TASKS',
      triggerEvent: 'task.created',
      actions: [{ id: 'a1', type: 'send_email' }],
    },
  });
  return { id: rule.id, version: v.id };
}
const run = (data: Record<string, unknown> = {}) => {
  const id = randomUUID();
  return A().automationRun.create({
    data: {
      id,
      businessId: f.firmA,
      ruleId: ruleA.id,
      ruleVersionId: ruleA.version,
      sourceModule: 'TASKS',
      sourceEventKey: `task.created:${id}`,
      correlationId: id,
      ...data,
    },
  });
};
const action = (runId: string, data: Record<string, unknown> = {}) =>
  A().automationActionExecution.create({
    data: {
      businessId: f.firmA,
      runId,
      actionKey: 'a1',
      position: 0,
      actionType: 'send_email',
      idempotencyKey: `${runId}:a1:${randomUUID()}`,
      ...data,
    },
  });
const done = { finishedAt: new Date() };

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38au');
  ruleA = await makeRule(f.firmA);
});

describe('isolation', () => {
  it('another firm sees no run, action or settings', async () => {
    const r = await run();
    await action(r.id);
    await A().automationSettings.create({ data: { businessId: f.firmA } });
    const B = db.forBusiness(f.firmB);
    expect(await B.automationRun.findMany()).toEqual([]);
    expect(await B.automationActionExecution.findMany()).toEqual([]);
    expect(await B.automationSettings.findMany()).toEqual([]);
  });

  it("a run cannot use another firm's rule, version, client or parent run", async () => {
    const ruleB = await makeRule(f.firmB);
    expect(await failure(run({ ruleId: ruleB.id, ruleVersionId: ruleB.version }))).toMatch(
      /foreign key|rule's own/i,
    );
    expect(await failure(run({ clientId: f.clientB }))).toMatch(/foreign key/i);
    expect(await failure(run({ parentRunId: randomUUID() }))).toMatch(/foreign key/i);
    const other = await makeRule(f.firmA);
    expect(await failure(run({ ruleVersionId: other.version }))).toMatch(/rule's own/);
  });
});

describe('runs', () => {
  it('start once per rule and source event', async () => {
    const key = `deadline.approaching:${randomUUID()}`;
    await run({ sourceEventKey: key });
    expect(await failure(run({ sourceEventKey: key }))).toMatch(/unique/i);
    const other = await makeRule(f.firmA);
    await expect(
      run({ ruleId: other.id, ruleVersionId: other.version, sourceEventKey: key }),
    ).resolves.toBeTruthy();
  });

  it('a finished run has its end time, a started one its start, a re-run its reason', async () => {
    for (const data of [
      { status: 'SUCCESS' },
      { status: 'SUCCESS', ...done },
      { finishedAt: new Date() },
      { status: 'RUNNING' },
      { depth: 11 },
      { durationMs: -1 },
      { errorCode: 'X' },
      { recordKind: 'deadline' },
      { sourceEventKey: ' ' },
      { rerunCount: 1 },
      { rerunCount: 1, lastRerunAt: new Date() },
    ]) {
      expect(await failure(run(data))).toMatch(/check constraint/i);
    }
    const started = new Date();
    await expect(run({ status: 'SUCCESS', startedAt: started, ...done })).resolves.toBeTruthy();
    await expect(
      run({
        status: 'FAILED',
        startedAt: started,
        ...done,
        errorCode: 'EMAIL_UNDELIVERABLE',
        message: 'Invalid address',
      }),
    ).resolves.toBeTruthy();
    await expect(run({ status: 'SKIPPED', ...done, errorCode: 'NO_MATCH' })).resolves.toBeTruthy();
    await expect(
      run({
        status: 'PARTIAL_SUCCESS',
        startedAt: started,
        ...done,
        errorCode: 'ONE_FAILED',
        rerunCount: 1,
        lastRerunAt: new Date(),
        lastRerunReason: 'Fixed the address',
        lastRerunByUserId: f.memberA,
      }),
    ).resolves.toBeTruthy();
  });

  it('what a run started from never changes', async () => {
    const r = await run();
    const other = await makeRule(f.firmA);
    for (const data of [
      { ruleId: other.id },
      { ruleVersionId: other.version },
      { sourceEventKey: 'changed' },
      { dryRun: true },
      { depth: 1 },
      { correlationId: randomUUID() },
    ]) {
      expect(await failure(A().automationRun.update({ where: { id: r.id }, data }))).toMatch(
        /never changes/,
      );
    }
    await expect(
      A().automationRun.update({
        where: { id: r.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'RUNNING' });
  });

  it('links a chain of runs by parent', async () => {
    const parent = await run();
    await expect(
      run({ parentRunId: parent.id, depth: 1, correlationId: parent.correlationId }),
    ).resolves.toBeTruthy();
  });
});

describe('action executions', () => {
  it('have one row per action of a run and one idempotency key per firm', async () => {
    const r = await run();
    await action(r.id, { idempotencyKey: `k:${r.id}` });
    expect(await failure(action(r.id))).toMatch(/unique/i); // same action key
    expect(await failure(action(r.id, { actionKey: 'a2', idempotencyKey: `k:${r.id}` }))).toMatch(
      /unique/i,
    );
    await expect(action(r.id, { actionKey: 'a2', position: 1 })).resolves.toBeTruthy();
  });

  it('checks the shape: finished states have their end time, only a failure has an error code', async () => {
    const r = await run();
    let n = 0;
    const make = (data: Record<string, unknown>) => action(r.id, { actionKey: `k${++n}`, ...data });
    for (const data of [
      { status: 'SUCCESS' },
      { finishedAt: new Date() },
      { status: 'FAILED', errorCode: 'X' },
      { status: 'SUCCESS', ...done, errorCode: 'X' },
      { resultKind: 'task' },
      { position: -1 },
      { attempts: -1 },
      { actionType: ' ' },
    ]) {
      expect(await failure(make(data))).toMatch(/check constraint/i);
    }
    await expect(
      make({ status: 'SUCCESS', ...done, resultKind: 'task', resultId: randomUUID() }),
    ).resolves.toBeTruthy();
    await expect(
      make({
        status: 'FAILED',
        ...done,
        errorCode: 'EMAIL_UNDELIVERABLE',
        retryable: false,
        attempts: 1,
      }),
    ).resolves.toBeTruthy();
    await expect(make({ scheduledFor: new Date(Date.now() + 86_400_000) })).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('a failed action can be retried, a succeeded one never runs again', async () => {
    const r = await run();
    const failed = await action(r.id, {
      actionKey: 'f',
      status: 'FAILED',
      ...done,
      errorCode: 'TIMEOUT',
    });
    const retried = await A().automationActionExecution.update({
      where: { id: failed.id },
      data: { status: 'SUCCESS', attempts: 2, errorCode: null },
    });
    expect(retried.status).toBe('SUCCESS');
    const ok = await action(r.id, {
      actionKey: 's',
      status: 'SUCCESS',
      ...done,
      attempts: 1,
      resultKind: 'task',
      resultId: randomUUID(),
    });
    const upd = (data: Record<string, unknown>) =>
      A().automationActionExecution.update({ where: { id: ok.id }, data });
    expect(await failure(upd({ status: 'PENDING', finishedAt: null }))).toMatch(/never run again/);
    expect(await failure(upd({ status: 'FAILED', errorCode: 'X' }))).toMatch(/never run again/);
    expect(await failure(upd({ attempts: 2 }))).toMatch(/keeps its result/);
    expect(await failure(upd({ resultId: randomUUID() }))).toMatch(/keeps its result/);
    expect(await failure(upd({ idempotencyKey: 'other' }))).toMatch(/keeps its run/);
    expect(await failure(upd({ actionKey: 'other' }))).toMatch(/keeps its run/);
  });
});

describe('settings', () => {
  it('has one row per firm with sane limits', async () => {
    await expect(
      A().automationSettings.findUniqueOrThrow({ where: { businessId: f.firmA } }),
    ).resolves.toMatchObject({ maxDepth: 3, defaultDedupeDays: 7, logRetentionDays: 365 });
    expect(await failure(A().automationSettings.create({ data: { businessId: f.firmA } }))).toMatch(
      /unique/i,
    );
    const set = (data: Record<string, unknown>) =>
      A().automationSettings.update({ where: { businessId: f.firmA }, data });
    for (const data of [
      { maxDepth: 0 },
      { maxDepth: 11 },
      { defaultDedupeDays: 91 },
      { safetyThreshold: 0 },
      { minutesSavedPerAction: 241 },
      { logRetentionDays: 30 },
      { quietStart: new Date('1970-01-01T21:00:00Z') }, // quiet hours need both ends
    ]) {
      expect(await failure(set(data))).toMatch(/check constraint/i);
    }
    await expect(
      set({
        quietStart: new Date('1970-01-01T21:00:00Z'),
        quietEnd: new Date('1970-01-01T07:00:00Z'),
        failureAlertUserIds: [f.memberA],
      }),
    ).resolves.toBeTruthy();
  });
});
