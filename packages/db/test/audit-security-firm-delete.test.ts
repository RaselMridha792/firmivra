// R0 stage B4 (Oct 17): deleting a firm (app_delete_business_data, as the migrate role runs on RDS:
// no superuser, no BYPASSRLS) takes its audit rows and everything hanging off them: the alerts on
// its events (with or without the firm on the alert) and the team's notes on them, edits included.
// The platform's own rows stay: a platform row about the firm keeps the firm's id (history outlives
// the firm), and one whose parent was a firm event loses only that link.
//
// Its own database (not the suite's shared `dbUrls`): app_delete_business_data takes ACCESS
// EXCLUSIVE locks on every firm table while it runs.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';

const SLOW = 300_000;
let owner: ReturnType<typeof createPrismaClient>;
const run = randomUUID().slice(0, 8);
const admin = randomUUID();

beforeAll(async () => {
  const urls = await prepareTestDatabase('audit_delete');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: admin,
        cognitoSub: admin,
        pool: 'ADMIN',
        email: `${admin}@sup.test`,
        name: 'Fake',
      },
    });
    await tx.platformAdmin.create({ data: { userId: admin, role: 'SUPER_ADMIN' } });
  });
}, SLOW);

afterAll(async () => {
  await owner?.$disconnect();
});

describe('deleting a firm with audit and security rows', () => {
  it(
    "takes the firm's events, their alerts and notes; keeps the platform's rows",
    async () => {
      const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.business.create({ data: { slug: `b4-del-${run}`, name: 'Leaving' } }),
      );
      const event = (data: Record<string, unknown>) =>
        runInScope(owner, { kind: 'platform' }, (tx) =>
          tx.auditLog.create({
            data: {
              action: 'login.failed',
              entityType: 'login',
              category: 'AUTHENTICATION',
              severity: 'MEDIUM',
              outcome: 'FAILURE',
              actorType: 'ANONYMOUS',
              ...data,
            },
          }),
        );
      const firmEvent = await event({ businessId: firm.id });
      const firmChild = await event({ businessId: firm.id, parentEventId: firmEvent.id });
      const platformRow = await event({
        action: 'firm.suspended',
        entityType: 'business',
        subjectBusinessId: firm.id,
        parentEventId: firmEvent.id,
        category: 'SECURITY',
        actorType: 'SYSTEM',
        outcome: 'SUCCESS',
      });
      const alertBase = { ruleId: 'login.failed_burst', severity: 'HIGH' as const, title: 'Burst' };
      await runInScope(owner, { kind: 'platform' }, async (tx) => {
        await tx.securityAlert.create({
          data: {
            ...alertBase,
            auditLogId: firmEvent.id,
            businessId: firm.id,
            eventKey: `a-${run}`,
          },
        });
        // An alert on the firm's event that does not name the firm still goes with the event.
        await tx.securityAlert.create({
          data: { ...alertBase, auditLogId: firmChild.id, eventKey: `b-${run}` },
        });
        await tx.securityAlert.create({
          data: { ...alertBase, auditLogId: platformRow.id, eventKey: `c-${run}` },
        });
      });
      await runInScope(owner, { kind: 'admin', adminUserId: admin }, async (tx) => {
        const note = await tx.auditInvestigationNote.create({
          data: { auditLogId: firmEvent.id, authorUserId: admin, body: 'First look.' },
        });
        await tx.auditInvestigationNote.create({
          data: {
            auditLogId: firmEvent.id,
            authorUserId: admin,
            body: 'First look, corrected.',
            supersedesNoteId: note.id,
          },
        });
      });

      const role = `fv_b4del_${run}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            await tx.$queryRaw`SELECT * FROM app_delete_business_data(${firm.id}::uuid)`;
          },
          { timeout: SLOW },
        );
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }

      const left = await owner.$queryRaw<{ t: string; n: number }[]>`
        SELECT 'events' AS t, count(*)::int AS n FROM audit_logs WHERE business_id = ${firm.id}::uuid
        UNION ALL SELECT 'alerts', count(*)::int FROM security_alerts
          WHERE event_key IN (${`a-${run}`}, ${`b-${run}`}, ${`c-${run}`})
        UNION ALL SELECT 'notes', count(*)::int FROM audit_investigation_notes
          WHERE audit_log_id = ${firmEvent.id}::uuid
        UNION ALL SELECT 'firm', count(*)::int FROM businesses WHERE id = ${firm.id}::uuid`;
      expect(Object.fromEntries(left.map((r) => [r.t, r.n]))).toEqual({
        events: 0,
        alerts: 1,
        notes: 0,
        firm: 0,
      });
      const [kept] = await owner.$queryRaw<
        { subject_business_id: string; parent_event_id: string | null }[]
      >`SELECT subject_business_id::text, parent_event_id::text FROM audit_logs WHERE id = ${platformRow.id}::uuid`;
      expect(kept).toEqual({ subject_business_id: firm.id, parent_event_id: null });
    },
    SLOW,
  );
});
