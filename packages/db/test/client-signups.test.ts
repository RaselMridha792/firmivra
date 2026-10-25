// R55's Client Sign-ups (R1, Oct 25; migrations r1_signup_account_columns, r1_signup_policy and
// r1_signup_review_tables): the approval mode, each sign-up's version and match flag, match
// candidates, append-only call verifications and idempotent operations. A firm never sees or
// writes another firm's rows. Runs as the app role under RLS; setup uses the owner role.
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const ids = { accountA: '', accountA2: '', accountB: '' };
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A synthetic portal login with a sign-up in `businessId`. */
async function signUp(businessId: string): Promise<string> {
  const userId = randomUUID();
  const email = `${userId}@signups.test`;
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: { id: userId, cognitoSub: userId, pool: 'CLIENT', email, name: 'Fake' },
    }),
  );
  return runInScope(
    owner,
    { kind: 'business', businessId },
    async (tx) => (await tx.clientAccount.create({ data: { businessId, userId, email } })).id,
  );
}

const candidate = (data: Record<string, unknown> = {}) =>
  A().clientSignupMatchCandidate.create({
    data: {
      businessId: f.firmA,
      clientAccountId: ids.accountA,
      candidateClientId: f.clientA,
      matchedOn: ['email'],
      ...data,
    },
  });
const verification = (data: Record<string, unknown> = {}) =>
  A().clientSignupVerification.create({
    data: {
      businessId: f.firmA,
      clientAccountId: ids.accountA,
      candidateClientId: f.clientA,
      contactRef: 'CLIENT_PHONE',
      callOutcome: 'REACHED',
      identityResult: 'VERIFIED',
      actorUserId: f.memberA,
      ...data,
    },
  });
const operation = (data: Record<string, unknown> = {}) =>
  A().clientSignupOperation.create({
    data: {
      businessId: f.firmA,
      clientAccountId: ids.accountA,
      kind: 'APPROVE',
      idempotencyKey: randomUUID(),
      requestHash: sha(randomUUID()),
      status: 'COMMITTED',
      correlationId: randomUUID(),
      actorUserId: f.memberA,
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1su');
  ids.accountA = await signUp(f.firmA);
  ids.accountA2 = await signUp(f.firmA);
  ids.accountB = await signUp(f.firmB);
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.businessSettings.create({ data: { businessId: f.firmA } }),
  );
});

describe('the approval mode and each sign-up', () => {
  it('start MANUAL at policy version 1, and a sign-up UNCHECKED at version 1, not automatic', async () => {
    await expect(
      A().businessSettings.findUnique({ where: { businessId: f.firmA } }),
    ).resolves.toMatchObject({ clientSignupMode: 'MANUAL', clientSignupPolicyVersion: 1 });
    await expect(
      A().clientAccount.findUnique({ where: { id: ids.accountA } }),
    ).resolves.toMatchObject({
      version: 1,
      matchStatus: 'UNCHECKED',
      matchCheckedAt: null,
      decisionPolicyVersion: null,
      decidedAutomatically: false,
    });
  });

  it('keeps versions at 1 or more, and a policy change by a member of the firm', async () => {
    const where = { businessId: f.firmA };
    expect(
      await failure(A().businessSettings.update({ where, data: { clientSignupPolicyVersion: 0 } })),
    ).toMatch(/check constraint/i);
    expect(
      await failure(
        A().clientAccount.update({ where: { id: ids.accountA }, data: { version: 0 } }),
      ),
    ).toMatch(/check constraint/i);
    expect(
      await failure(
        A().businessSettings.update({
          where,
          data: {
            clientSignupPolicyChangedByUserId: f.memberB,
            clientSignupPolicyChangedAt: new Date(),
          },
        }),
      ),
    ).toMatch(/foreign key/i);
    await expect(
      A().businessSettings.update({
        where,
        data: {
          clientSignupMode: 'AUTOMATIC',
          clientSignupPolicyVersion: 2,
          clientSignupPolicyChangedByUserId: f.memberA,
          clientSignupPolicyChangedAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ clientSignupMode: 'AUTOMATIC', clientSignupPolicyVersion: 2 });
  });
});

describe('match candidates', () => {
  it('hold field names only, a short rationale, and the firm’s own client', async () => {
    for (const data of [
      { matchedOn: [] },
      { matchedOn: ['someone@example.test'] },
      { matchedOn: ['Email'] },
    ]) {
      expect(await failure(candidate({ ...data, clientAccountId: ids.accountA2 }))).toMatch(
        /check constraint/i,
      );
    }
    expect(
      await failure(candidate({ clientAccountId: ids.accountA2, rationale: 'x'.repeat(501) })),
    ).toMatch(/check constraint/i);
    expect(await failure(candidate({ candidateClientId: f.clientB }))).toMatch(/foreign key/i);
    const row = await candidate({ matchedOn: ['email', 'name_and_birth_date'] });
    expect(row.resolution).toBe('OPEN');
    expect(await failure(candidate())).toMatch(/unique constraint/i);
  });

  it('say who reviewed them and when once resolved, and are never deleted', async () => {
    const row = await candidate({ clientAccountId: ids.accountA2 });
    const update = (data: Record<string, unknown>) =>
      A().clientSignupMatchCandidate.update({ where: { id: row.id }, data });
    expect(await failure(update({ resolution: 'NOT_A_MATCH' }))).toMatch(/check constraint/i);
    expect(
      await failure(
        update({ resolution: 'NOT_A_MATCH', reviewedByUserId: f.memberB, reviewedAt: new Date() }),
      ),
    ).toMatch(/foreign key/i);
    await expect(
      update({ resolution: 'NOT_A_MATCH', reviewedByUserId: f.memberA, reviewedAt: new Date() }),
    ).resolves.toMatchObject({ resolution: 'NOT_A_MATCH' });
    expect(await failure(A().clientSignupMatchCandidate.deleteMany({}))).toMatch(
      /permission denied/i,
    );
  });
});

describe('call verifications', () => {
  it('record a permission and its time together, or neither', async () => {
    expect(await failure(verification({ permissionScope: 'LINK_RECORD' }))).toMatch(
      /check constraint/i,
    );
    expect(await failure(verification({ permissionRecordedAt: new Date() }))).toMatch(
      /check constraint/i,
    );
    await expect(
      verification({ permissionScope: 'BOTH', permissionRecordedAt: new Date() }),
    ).resolves.toMatchObject({ permissionScope: 'BOTH' });
    expect(await failure(verification({ actorUserId: f.memberB }))).toMatch(/foreign key/i);
  });

  it('are append-only: never changed, never deleted', async () => {
    const row = await verification();
    expect(
      await failure(
        A().clientSignupVerification.update({
          where: { id: row.id },
          data: { callOutcome: 'NOT_REACHED' },
        }),
      ),
    ).toMatch(/permission denied/i);
    expect(await failure(A().clientSignupVerification.deleteMany({}))).toMatch(
      /permission denied/i,
    );
  });
});

describe('operations', () => {
  it('name a sign-up for every kind but POLICY_CHANGE, which names none', async () => {
    await expect(
      operation({ kind: 'POLICY_CHANGE', clientAccountId: null }),
    ).resolves.toBeDefined();
    expect(await failure(operation({ kind: 'POLICY_CHANGE' }))).toMatch(/check constraint/i);
    expect(await failure(operation({ kind: 'APPROVE', clientAccountId: null }))).toMatch(
      /check constraint/i,
    );
  });

  it('keep a 64-hex payload hash, attempts of 0 or more, and one key per firm', async () => {
    expect(await failure(operation({ requestHash: 'abc' }))).toMatch(/check constraint/i);
    expect(await failure(operation({ attempts: -1 }))).toMatch(/check constraint/i);
    const key = randomUUID();
    await operation({ idempotencyKey: key });
    expect(await failure(operation({ idempotencyKey: key }))).toMatch(/unique constraint/i);
  });

  it('dispatch an invite or a recovery at most once per sign-up', async () => {
    for (const kind of ['INVITE_DELIVERY', 'RECOVERY_DELIVERY']) {
      await operation({ kind, status: 'PENDING', clientAccountId: ids.accountA2 });
      expect(await failure(operation({ kind, clientAccountId: ids.accountA2 }))).toMatch(
        /unique constraint/i,
      );
    }
    // Other kinds may repeat under new keys.
    await operation({ kind: 'KEEP_PENDING', clientAccountId: ids.accountA2 });
    await operation({ kind: 'KEEP_PENDING', clientAccountId: ids.accountA2 });
  });

  it('change only their state: never kind, key, hash or sign-up; never deleted', async () => {
    const row = await operation({ status: 'PENDING' });
    const update = (data: Record<string, unknown>) =>
      A().clientSignupOperation.update({ where: { id: row.id }, data });
    await expect(
      update({ status: 'FAILED', attempts: 1, lastErrorCode: 'TIMEOUT' }),
    ).resolves.toMatchObject({ status: 'FAILED', attempts: 1 });
    for (const data of [
      { kind: 'DECLINE' },
      { idempotencyKey: randomUUID() },
      { requestHash: sha('other') },
      { clientAccountId: ids.accountA2 },
    ]) {
      expect(await failure(update(data))).toMatch(/never change/);
    }
    expect(await failure(A().clientSignupOperation.deleteMany({}))).toMatch(/permission denied/i);
  });
});

describe('isolation', () => {
  it("firm B cannot see, change or write firm A's sign-up rows", async () => {
    const fresh = await signUp(f.firmA);
    const [c, v, o] = [
      await candidate({ clientAccountId: fresh }),
      await verification({ clientAccountId: fresh }),
      await operation({ clientAccountId: fresh }),
    ];
    expect(await B().clientSignupMatchCandidate.findMany()).toEqual([]);
    expect(await B().clientSignupVerification.findMany()).toEqual([]);
    expect(await B().clientSignupOperation.findMany()).toEqual([]);
    expect(
      (
        await B().clientSignupMatchCandidate.updateMany({
          where: { id: c.id },
          data: { rationale: 'x' },
        })
      ).count,
    ).toBe(0);
    expect(
      (await B().clientSignupOperation.updateMany({ where: { id: o.id }, data: { attempts: 1 } }))
        .count,
    ).toBe(0);
    expect(v.businessId).toBe(f.firmA);
    // Rows for firm A's sign-up: refused under firm B's id by RLS, and under B's own id by the key.
    const wrongFirm = {
      businessId: f.firmA,
      clientAccountId: ids.accountA,
      candidateClientId: f.clientA,
    };
    expect(
      await failure(
        B().clientSignupMatchCandidate.create({ data: { ...wrongFirm, matchedOn: ['email'] } }),
      ),
    ).toMatch(/row-level security/i);
    expect(
      await failure(
        B().clientSignupOperation.create({
          data: {
            businessId: f.firmB,
            clientAccountId: ids.accountA,
            kind: 'APPROVE',
            idempotencyKey: randomUUID(),
            requestHash: sha('b'),
            status: 'COMMITTED',
            correlationId: randomUUID(),
          },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(
      await failure(
        B().clientSignupVerification.create({
          data: {
            businessId: f.firmB,
            clientAccountId: ids.accountB,
            candidateClientId: f.clientA,
            contactRef: 'CLIENT_EMAIL',
            callOutcome: 'NOT_REACHED',
            identityResult: 'NOT_VERIFIED',
            actorUserId: f.memberB,
          },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});
