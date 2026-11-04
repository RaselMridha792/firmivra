// AU-F08 to F11 (Octavia's Oct 28 review): the trigger events that come from the source modules'
// own audit log. Each audit row is one occurrence; the metadata decides which event a row is (a
// first submission or a new version, an approval or a request for a replacement); the record, its
// client and its label come from the module's table. Every catalog event has a loader.
import { describe, expect, it } from 'vitest';
import type { TxClient } from '@firmivra/db';
import { AUDIT_EVENTS, loadAuditEvent } from '../../src/automations/audit-events.js';
import { EVENTS } from '../../src/automations/catalog.js';
import { LOADED_EVENTS } from '../../src/automations/matching.js';

const FIRM = '01900000-0000-7000-8000-000000000001';
const CLIENT = '01900000-0000-7000-8000-0000000000c1';
const INTAKE = '01900000-0000-7000-8000-0000000000a1';
const DOC = '01900000-0000-7000-8000-0000000000d1';
const RETURN = '01900000-0000-7000-8000-0000000000e1';
const at = new Date('2026-11-04T15:00:00Z');

type Row = { id: string; action: string; entityType: string; entityId: string; metadata: object };
let seq = 0;
const audit = (
  action: string,
  entityType: string,
  entityId: string,
  metadata: object = {},
): Row => ({
  id: `01900000-0000-7000-8000-${String(++seq).padStart(12, '0')}`,
  action,
  entityType,
  entityId,
  metadata,
});

/** A stand-in for the firm's transaction: the audit rows and one record of each kind. */
function txOf(rows: Row[]) {
  return {
    auditLog: {
      findMany: ({ where }: { where: { action: { in: string[] }; entityType: string } }) =>
        Promise.resolve(
          rows
            .filter((r) => where.action.in.includes(r.action) && r.entityType === where.entityType)
            .map((r) => ({ ...r, createdAt: at })),
        ),
    },
    client: {
      findMany: () =>
        Promise.resolve([
          { id: CLIENT, displayName: 'Jamie Sample', accountType: 'INDIVIDUAL', status: 'ACTIVE' },
        ]),
    },
    intake: {
      findMany: () =>
        Promise.resolve([
          {
            id: INTAKE,
            status: 'SUBMITTED',
            form: { title: '2026 Individual Organizer (fake)' },
            engagement: { clientId: CLIENT, client: { accountType: 'INDIVIDUAL' } },
          },
        ]),
    },
    taxReturn: {
      findMany: () =>
        Promise.resolve([
          {
            id: RETURN,
            clientId: CLIENT,
            taxYear: 2025,
            formType: '1040',
            workflowStatus: 'ACCEPTED',
            client: { accountType: 'INDIVIDUAL' },
          },
        ]),
    },
    document: {
      findMany: () =>
        Promise.resolve([
          {
            id: DOC,
            fileName: 'w2-fake.pdf',
            clientId: CLIENT,
            client: { accountType: 'INDIVIDUAL' },
          },
        ]),
    },
  } as unknown as TxClient;
}

const scope = { businessId: FIRM, now: at, today: '2026-11-04', since: new Date(0) };
const load = (code: string, rows: Row[]) => loadAuditEvent(txOf(rows), AUDIT_EVENTS[code]!, scope);

describe('audit-sourced trigger events', () => {
  it('splits a first submission from a new version', async () => {
    const rows = [
      audit('intake.submitted', 'intake', INTAKE, { version: 1 }),
      audit('intake.submitted', 'intake', INTAKE, { version: 2 }),
    ];
    const first = await load('intake.submitted', rows);
    const again = await load('intake.resubmitted', rows);
    expect(first.map((c) => c.occurrence)).toEqual([rows[0]!.id]);
    expect(again.map((c) => c.occurrence)).toEqual([rows[1]!.id]);
    // The form's client is the engagement's, and its label the form's title.
    expect(first[0]).toMatchObject({
      recordKind: 'intake',
      recordId: INTAKE,
      clientId: CLIENT,
      label: '2026 Individual Organizer (fake)',
      fields: { clientType: 'INDIVIDUAL', status: 'SUBMITTED' },
    });
  });

  it('tells an approval from a request for a replacement; starting a review is neither', async () => {
    const rows = ['START', 'VERIFY', 'REQUEST_REPLACEMENT', 'COMPLETE'].map((action) =>
      audit('document.reviewed', 'document', DOC, { action }),
    );
    expect((await load('document.approved', rows)).map((c) => c.occurrence)).toEqual([
      rows[1]!.id,
      rows[3]!.id,
    ]);
    expect((await load('document.returned', rows)).map((c) => c.occurrence)).toEqual([rows[2]!.id]);
  });

  it('counts a client update only when it changed the assignment', async () => {
    const rows = [
      audit('client.updated', 'client', CLIENT, { fields: ['displayName'] }),
      audit('client.updated', 'client', CLIENT, { fields: ['assignedUserId', 'email'] }),
    ];
    const hits = await load('client.assignment_changed', rows);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ occurrence: rows[1]!.id, label: 'Jamie Sample' });
  });

  it('a status change carries the new and previous status, for Accepted or Rejected conditions', async () => {
    const rows = [
      audit('tax_return.status_changed', 'tax_return', RETURN, {
        from: 'TRANSMITTED',
        to: 'ACCEPTED',
      }),
    ];
    const [hit] = await load('tax_return.status_changed', rows);
    expect(hit).toMatchObject({
      recordKind: 'tax_return',
      clientId: CLIENT,
      label: '1040 2025',
      fields: {
        newStatus: 'ACCEPTED',
        previousStatus: 'TRANSMITTED',
        workflowStatus: 'ACCEPTED',
        taxYear: 2025,
      },
    });
  });

  it('a service record takes the client the module wrote on the row (payroll, bookkeeping)', async () => {
    const run = '01900000-0000-7000-8000-0000000000f1';
    const rows = [
      audit('payroll.run.submitted', 'payroll_run', run, {
        clientId: CLIENT,
        payrollClientId: run,
      }),
      // A row without a client of this firm starts nothing.
      audit('payroll.run.submitted', 'payroll_run', run, { payrollClientId: run }),
    ];
    const hits = await load('payroll.run_submitted', rows);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      recordKind: 'payroll_run',
      recordId: run,
      clientId: CLIENT,
      label: 'Jamie Sample',
      fields: { clientType: 'INDIVIDUAL' },
    });
    const moved = await load('bookkeeping.status_changed', [
      audit('bookkeeping.client.status_changed', 'bookkeeping_client', run, {
        clientId: CLIENT,
        from: 'ON_TRACK',
        to: 'OVERDUE',
      }),
    ]);
    expect(moved[0]?.fields).toMatchObject({ newStatus: 'OVERDUE', previousStatus: 'ON_TRACK' });
  });

  it('one run key per audit row, and nothing for a record that is gone', async () => {
    const gone = '01900000-0000-7000-8000-0000000000ff';
    const rows = [
      audit('client.archived', 'client', CLIENT),
      audit('client.archived', 'client', CLIENT),
      audit('client.archived', 'client', gone),
    ];
    const hits = await load('client.archived', rows);
    expect(hits.map((c) => c.recordId)).toEqual([CLIENT, CLIENT]);
    expect(new Set(hits.map((c) => c.occurrence)).size).toBe(2);
  });

  it('every event in the catalog has a loader, and every loader is in the catalog', () => {
    const listed = EVENTS.map((e) => e.code);
    expect(listed.filter((code) => !LOADED_EVENTS.has(code))).toEqual([]);
    expect([...LOADED_EVENTS].filter((code) => !listed.includes(code))).toEqual([]);
  });
});
