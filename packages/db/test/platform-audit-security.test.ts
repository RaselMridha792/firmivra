// R0 stage B4 (Oct 17): Audit & Security. audit_logs gains the normalized event fields (all
// optional, so existing writers keep working) and the Super Admin team now reads every audit row
// across firms; a firm still reads only its own. Security alerts, investigation notes and the
// one-row security policy are platform data: no firm scope reaches them, and nothing is deleted.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  ceo: randomUUID(),
  member: randomUUID(),
  unlinked: randomUUID(),
  firmA: '',
  firmB: '',
};

const asAdmin = <T>(adminUserId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.ceo, ids.member, ids.unlinked]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceo, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.member, role: 'TEAM_MEMBER' } });
    // A TEAM_MEMBER with no member row (not yet placed in the hierarchy) is not on the team.
    await tx.platformAdmin.create({ data: { userId: ids.unlinked, role: 'TEAM_MEMBER' } });
    const dept = await tx.platformDepartment.create({
      data: { code: `B4_DEPT_${run.toUpperCase()}`, name: 'Security' },
    });
    const ceoRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B4_CEO_${run.toUpperCase()}`,
        title: 'CEO',
        level: 'CEO',
        departmentId: dept.id,
        defaultScopeType: 'COMPANY',
      },
    });
    const icRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B4_IC_${run.toUpperCase()}`,
        title: 'Security Analyst',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultReportsToRoleId: ceoRole.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
    ids.firmA = (await tx.business.create({ data: { slug: `b4-a-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `b4-b-${run}`, name: 'B' } })).id;
    await tx.platformMember.create({
      data: {
        userId: ids.ceo,
        roleDefinitionId: ceoRole.id,
        departmentId: dept.id,
        scopeType: 'COMPANY',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.member,
        roleDefinitionId: icRole.id,
        departmentId: dept.id,
        reportsToUserId: ids.ceo,
        scopeType: 'OWN_RECORDS',
      },
    });
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

/** A normalized event in a firm's log, written as the firm (business scope). */
const firmEvent = (businessId: string, action: string, extra: Record<string, unknown> = {}) =>
  asFirm(businessId, (tx) =>
    tx.auditLog.create({
      data: {
        businessId,
        action,
        entityType: 'login',
        category: 'AUTHENTICATION',
        severity: 'MEDIUM',
        outcome: 'FAILURE',
        actorType: 'ANONYMOUS',
        requestId: `${action}-${run}`,
        ...extra,
      },
    }),
  );

const alert = (auditLogId: string, key: string, extra: Record<string, unknown> = {}) => ({
  auditLogId,
  businessId: ids.firmA,
  ruleId: 'login.failed_burst',
  severity: 'HIGH' as const,
  title: 'Repeated failed sign-ins',
  eventKey: `${key}-${run}`,
  ...extra,
});

describe('audit_logs: the normalized event fields', () => {
  it('a row without them is written as before; a row with a category carries severity, outcome and actor type', async () => {
    await expect(
      asFirm(ids.firmA, (tx) =>
        tx.auditLog.create({
          data: { businessId: ids.firmA, action: 'client.updated', entityType: 'client' },
        }),
      ),
    ).resolves.toMatchObject({ category: null, severity: null });
    expect(
      await outcome(
        asFirm(ids.firmA, (tx) =>
          tx.auditLog.create({
            data: {
              businessId: ids.firmA,
              action: 'login.failed',
              entityType: 'login',
              category: 'AUTHENTICATION',
            },
          }),
        ),
      ),
    ).toMatch(/audit_logs_event_values/);
  });

  it('keeps the bounds, and a firm row may only be about its own firm', async () => {
    for (const extra of [
      { riskScore: 101 },
      { ruleId: 'Not A Rule' },
      { authMethod: 'Password!' },
      { sessionId: 'has space' },
      { itemCount: -1 },
      { actorName: ' ' },
      { subjectBusinessId: ids.firmB },
    ]) {
      expect(await outcome(firmEvent(ids.firmA, 'login.failed', extra))).toMatch(
        /audit_logs_event_values/,
      );
    }
    await expect(
      firmEvent(ids.firmA, 'login.failed', { subjectBusinessId: ids.firmA, riskScore: 40 }),
    ).resolves.toMatchObject({ subjectBusinessId: ids.firmA });
    // A platform row names the firm it is about.
    await expect(
      asPlatform((tx) =>
        tx.auditLog.create({
          data: {
            action: 'firm.suspended',
            entityType: 'business',
            entityId: ids.firmB,
            subjectBusinessId: ids.firmB,
            category: 'SECURITY',
            severity: 'HIGH',
            outcome: 'SUCCESS',
            actorType: 'SYSTEM',
          },
        }),
      ),
    ).resolves.toMatchObject({ subjectBusinessId: ids.firmB });
  });

  it('the database stamps the time of a row the app writes; an event is not its own parent', async () => {
    const before = Date.now() - 1000;
    const row = await firmEvent(ids.firmA, 'login.failed', { createdAt: new Date('2020-01-01') });
    expect(row.createdAt.getTime()).toBeGreaterThan(before);
    expect(
      await outcome(
        asFirm(ids.firmA, (tx) =>
          tx.auditLog.create({
            data: {
              id: row.id.replace(/.$/, row.id.endsWith('0') ? '1' : '0'),
              businessId: ids.firmA,
              action: 'x.y',
              entityType: 'thing',
              parentEventId: row.id.replace(/.$/, row.id.endsWith('0') ? '1' : '0'),
            },
          }),
        ),
      ),
    ).toMatch(/audit_logs_event_values/);
    // A bulk operation's parent and its child, in the same firm.
    const child = await firmEvent(ids.firmA, 'record.updated', { parentEventId: row.id });
    expect(child.parentEventId).toBe(row.id);
  });
});

describe('audit_logs: who reads what (the wall change)', () => {
  it('the team reads every firm and platform row; a firm reads only its own; nobody edits or deletes', async () => {
    const a = await firmEvent(ids.firmA, 'login.failed');
    const b = await firmEvent(ids.firmB, 'login.failed');
    const where = { id: { in: [a.id, b.id] } };
    for (const admin of [ids.ceo, ids.member]) {
      expect(await asAdmin(admin, (tx) => tx.auditLog.count({ where }))).toBe(2);
    }
    // Not on the team (no member row): nothing.
    expect(await asAdmin(ids.unlinked, (tx) => tx.auditLog.count({ where }))).toBe(0);
    expect(await asFirm(ids.firmA, (tx) => tx.auditLog.findMany({ where }))).toEqual([
      expect.objectContaining({ id: a.id }),
    ]);
    expect(await asFirm(ids.firmB, (tx) => tx.auditLog.findMany({ where }))).toEqual([
      expect.objectContaining({ id: b.id }),
    ]);
    // Inserts are unchanged: admin scope writes only its own platform rows.
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditLog.create({
            data: {
              businessId: ids.firmA,
              action: 'x.y',
              entityType: 'thing',
              actorUserId: ids.member,
            },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) =>
          tx.auditLog.updateMany({ where: { id: a.id }, data: { severity: 'LOW' } }),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await outcome(asAdmin(ids.ceo, (tx) => tx.auditLog.deleteMany({ where: { id: a.id } }))),
    ).toMatch(/permission denied/i);
  });
});

describe('security alerts', () => {
  it('the rules engine raises one per key; the team reads them; no firm does', async () => {
    const event = await firmEvent(ids.firmA, 'login.failed');
    const raised = await asPlatform((tx) =>
      tx.securityAlert.create({ data: alert(event.id, 'one') }),
    );
    expect(raised).toMatchObject({ status: 'OPEN', acknowledgedAt: null, closedAt: null });
    expect(
      await outcome(asPlatform((tx) => tx.securityAlert.create({ data: alert(event.id, 'one') }))),
    ).toMatch(/Unique constraint/);
    expect(
      await asAdmin(ids.member, (tx) => tx.securityAlert.count({ where: { id: raised.id } })),
    ).toBe(1);
    expect(await asFirm(ids.firmA, (tx) => tx.securityAlert.count())).toBe(0);
    expect(
      await outcome(
        asFirm(ids.firmA, (tx) => tx.securityAlert.create({ data: alert(event.id, 'firm') })),
      ),
    ).toMatch(/row-level security/);
    // A new alert starts open.
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.securityAlert.create({ data: alert(event.id, 'closed', { status: 'RESOLVED' }) }),
        ),
      ),
    ).toMatch(/a new alert starts OPEN/);
  });

  it('the status moves forward only, and the database stamps who acknowledged and closed it', async () => {
    const event = await firmEvent(ids.firmA, 'login.failed');
    const a = await asPlatform((tx) => tx.securityAlert.create({ data: alert(event.id, 'flow') }));
    const acked = await asAdmin(ids.member, (tx) =>
      tx.securityAlert.update({
        where: { id: a.id },
        data: { status: 'ACKNOWLEDGED', assignedToUserId: ids.member },
      }),
    );
    expect(acked).toMatchObject({ acknowledgedByUserId: ids.member, assignedToUserId: ids.member });
    expect(acked.acknowledgedAt).not.toBeNull();
    for (const data of [
      { status: 'OPEN' as const },
      { title: 'Edited' },
      { severity: 'LOW' as const },
      { acknowledgedByUserId: ids.ceo },
      { resolutionNote: 'Not with the close' },
    ]) {
      expect(
        await outcome(
          asAdmin(ids.ceo, (tx) => tx.securityAlert.update({ where: { id: a.id }, data })),
        ),
      ).toMatch(/security alerts:/);
    }
    const closed = await asAdmin(ids.ceo, (tx) =>
      tx.securityAlert.update({
        where: { id: a.id },
        data: { status: 'RESOLVED', resolutionNote: 'Password reset by the client.' },
      }),
    );
    expect(closed).toMatchObject({ closedByUserId: ids.ceo, acknowledgedByUserId: ids.member });
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) =>
          tx.securityAlert.update({ where: { id: a.id }, data: { status: 'DISMISSED' } }),
        ),
      ),
    ).toMatch(/a RESOLVED alert never changes/);
    // Straight from open to dismissed, by a platform job: nobody is stamped.
    const b = await asPlatform((tx) => tx.securityAlert.create({ data: alert(event.id, 'auto') }));
    await expect(
      asPlatform((tx) =>
        tx.securityAlert.update({ where: { id: b.id }, data: { status: 'DISMISSED' } }),
      ),
    ).resolves.toMatchObject({ status: 'DISMISSED', closedByUserId: null });
    expect(
      await outcome(asAdmin(ids.ceo, (tx) => tx.securityAlert.deleteMany({ where: { id: b.id } }))),
    ).toMatch(/permission denied/i);
  });
});

describe('investigation notes', () => {
  it("are the team's, written as the signed-in member; an edit is a new note; a delete retracts once", async () => {
    const event = await firmEvent(ids.firmA, 'login.failed');
    const note = await asAdmin(ids.member, (tx) =>
      tx.auditInvestigationNote.create({
        data: { auditLogId: event.id, authorUserId: ids.member, body: 'Checked the source IP.' },
      }),
    );
    // Not as someone else, and never from a firm.
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditInvestigationNote.create({
            data: { auditLogId: event.id, authorUserId: ids.ceo, body: 'As the CEO' },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(await asFirm(ids.firmA, (tx) => tx.auditInvestigationNote.count())).toBe(0);
    expect(
      await asAdmin(ids.ceo, (tx) => tx.auditInvestigationNote.count({ where: { id: note.id } })),
    ).toBe(1);
    // The text never changes.
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditInvestigationNote.update({ where: { id: note.id }, data: { body: 'Edited' } }),
        ),
      ),
    ).toMatch(/a note never changes/);
    // Only the author edits it, once.
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.auditInvestigationNote.create({
        data: { auditLogId: event.id, authorUserId: ids.ceo, body: "The CEO's note." },
      }),
    );
    const ceoNote = await asAdmin(ids.ceo, (tx) =>
      tx.auditInvestigationNote.findFirstOrThrow({
        where: { auditLogId: event.id, authorUserId: ids.ceo },
      }),
    );
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditInvestigationNote.create({
            data: {
              auditLogId: event.id,
              authorUserId: ids.member,
              body: 'Rewritten',
              supersedesNoteId: ceoNote.id,
            },
          }),
        ),
      ),
    ).toMatch(/only the author edits a note/);
    const edit = await asAdmin(ids.member, (tx) =>
      tx.auditInvestigationNote.create({
        data: {
          auditLogId: event.id,
          authorUserId: ids.member,
          body: 'Checked the source IP: a residential address.',
          supersedesNoteId: note.id,
        },
      }),
    );
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditInvestigationNote.create({
            data: {
              auditLogId: event.id,
              authorUserId: ids.member,
              body: 'Again',
              supersedesNoteId: note.id,
            },
          }),
        ),
      ),
    ).toMatch(/Unique constraint/);
    // Retracted once, by the author only; the database stamps it.
    expect(
      await asAdmin(ids.ceo, (tx) =>
        tx.auditInvestigationNote.updateMany({
          where: { id: edit.id },
          data: { retractedAt: new Date() },
        }),
      ),
    ).toEqual({ count: 0 });
    const retracted = await asAdmin(ids.member, (tx) =>
      tx.auditInvestigationNote.update({
        where: { id: edit.id },
        data: { retractedAt: new Date('2020-01-01') },
      }),
    );
    expect(retracted.retractedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditInvestigationNote.update({
            where: { id: edit.id },
            data: { retractedAt: new Date() },
          }),
        ),
      ),
    ).toMatch(/retracted once/);
    expect(
      await outcome(
        asAdmin(ids.member, (tx) =>
          tx.auditInvestigationNote.deleteMany({ where: { id: note.id } }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });
});

describe('the security policy', () => {
  it('is one row: the team and the platform read it, no firm does, nobody adds or deletes one', async () => {
    expect(await asPlatform((tx) => tx.platformSecurityPolicy.count())).toBe(1);
    expect(await asAdmin(ids.member, (tx) => tx.platformSecurityPolicy.count())).toBe(1);
    expect(await asFirm(ids.firmA, (tx) => tx.platformSecurityPolicy.count())).toBe(0);
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) => tx.platformSecurityPolicy.create({ data: { id: 2 } })),
      ),
    ).toMatch(/permission denied/i);
    expect(await outcome(asAdmin(ids.ceo, (tx) => tx.platformSecurityPolicy.deleteMany()))).toMatch(
      /permission denied/i,
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformSecurityPolicy.update({
            where: { id: 1 },
            data: { mfa: { requiredFor: 'ALL_USERS', roleKeys: [] } },
          }),
        ),
      ),
    ).toMatch(/Record to update not found|No record was found/i);
  });

  it('every save is a new version, stamped; a save from a stale version finds nothing', async () => {
    const start = await asAdmin(ids.ceo, (tx) =>
      tx.platformSecurityPolicy.findUniqueOrThrow({ where: { id: 1 } }),
    );
    const session = { ...(start.session as Record<string, unknown>), idleTimeoutMinutes: 20 };
    const saved = await asAdmin(ids.member, (tx) =>
      tx.platformSecurityPolicy.updateMany({
        where: { id: 1, version: start.version },
        data: { session, version: 999 },
      }),
    );
    expect(saved).toEqual({ count: 1 });
    const after = await asAdmin(ids.ceo, (tx) =>
      tx.platformSecurityPolicy.findUniqueOrThrow({ where: { id: 1 } }),
    );
    expect(after).toMatchObject({ version: start.version + 1, updatedByUserId: ids.member });
    expect(
      await asAdmin(ids.ceo, (tx) =>
        tx.platformSecurityPolicy.updateMany({
          where: { id: 1, version: start.version },
          data: { session: start.session as object },
        }),
      ),
    ).toEqual({ count: 0 });
  });

  it('keeps the safety floors', async () => {
    const p = await asAdmin(ids.ceo, (tx) =>
      tx.platformSecurityPolicy.findUniqueOrThrow({ where: { id: 1 } }),
    );
    const obj = (v: unknown) => v as Record<string, unknown>;
    for (const data of [
      { mfa: { ...obj(p.mfa), requiredFor: 'NONE' } },
      { password: { ...obj(p.password), minLength: 6 } },
      { password: { ...obj(p.password), minLength: '12' } },
      { session: { ...obj(p.session), idleTimeoutMinutes: 10_000 } },
      { loginProtection: { ...obj(p.loginProtection), maxFailedAttempts: 100 } },
      { apiIntegrations: { ...obj(p.apiIntegrations), maskSecrets: false } },
      { auditRetention: { ...obj(p.auditRetention), retentionDays: 90 } },
      { auditRetention: { ...obj(p.auditRetention), archiveAfterDays: 3000 } },
      { exportControls: { ...obj(p.exportControls), exportRoleKeys: [1] } },
      { alertRouting: { ...obj(p.alertRouting), inApp: false } },
      { alertRouting: [] },
    ]) {
      expect(
        await outcome(
          asAdmin(ids.ceo, (tx) => tx.platformSecurityPolicy.update({ where: { id: 1 }, data })),
        ),
      ).toMatch(/platform_security_policy_values/);
    }
  });
});
