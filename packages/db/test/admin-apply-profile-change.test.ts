// app_admin_apply_profile_change (R1, Oct 24; Rasel's card, R56's draft): a Super Admin applies an
// approved Request Change to an ACTIVE firm (its legal name, its sealed EIN) from admin scope, and
// the firm's audit log gets one row with field names only. Not callable from a firm's scope, the
// platform scope or by anyone but a Super Admin; never for another firm's ticket. Runs as the app
// role (firmivra_app), the role the API calls it with.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope, type Scope, type TxClient } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const superAdmin = randomUUID();
const ids = { ticketA: '', ticketB: '' };
// A synthetic sealed value in the shape sealed_value_ok accepts: version 1, scheme 1, an 8-byte
// wrapped key, then 32 bytes of "ciphertext". No real EIN is in it.
const SEALED = Buffer.concat([Buffer.from([1, 1, 0, 8]), Buffer.alloc(8, 7), Buffer.alloc(32, 9)]);

const apply = (
  scope: Scope,
  args: {
    business?: string;
    ticket?: string;
    legalName?: string | null;
    einEnc?: Buffer | null;
    last4?: string | null;
    fields?: string[] | null;
  } = {},
) =>
  db.withScope(scope, async (tx: TxClient) => {
    const a = {
      business: f.firmA,
      ticket: ids.ticketA,
      legalName: 'Fake Firm A Legal LLC',
      einEnc: SEALED,
      last4: '4321',
      fields: ['legalName', 'ein'],
      ...args,
    };
    await tx.$executeRaw`SELECT app_admin_apply_profile_change(
      ${a.business}::uuid, ${a.ticket}::uuid, ${a.legalName}::text, ${a.einEnc}::bytea,
      ${a.last4}::text, ${a.fields}::text[])`;
    // The caller's transaction is back in admin scope, with no firm set.
    const [after] = await tx.$queryRaw<{ scope: string; firm: string }[]>`
      SELECT current_setting('app.scope', true) AS scope,
             coalesce(current_setting('app.current_business_id', true), '') AS firm`;
    return after;
  });
const asAdmin: Scope = { kind: 'admin', adminUserId: superAdmin };

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1apc');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: superAdmin,
        cognitoSub: superAdmin,
        pool: 'ADMIN',
        email: `${superAdmin}@r1apc.test`,
        name: 'Fake Admin',
      },
    });
    await tx.platformAdmin.create({ data: { userId: superAdmin } });
    await tx.business.update({ where: { id: f.firmA }, data: { status: 'ACTIVE' } });
  });
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.businessSettings.create({ data: { businessId: f.firmA } }),
  );
  await runInScope(owner, { kind: 'admin', adminUserId: superAdmin }, async (tx) => {
    const category = await tx.supportCategory.findFirstOrThrow({ select: { id: true } });
    const priority = await tx.supportPriority.findFirstOrThrow({ select: { id: true } });
    for (const [firm, contact, key] of [
      [f.firmA, f.memberA, 'ticketA'],
      [f.firmB, f.memberB, 'ticketB'],
    ] as const) {
      const t = await tx.supportTicket.create({
        data: {
          businessId: firm,
          contactUserId: contact,
          subject: 'Request Change: legal name and EIN (fake)',
          description: 'Proposed values (fake).',
          categoryId: category.id,
          priorityId: priority.id,
          source: 'EMAIL',
          createdByUserId: superAdmin,
        },
      });
      ids[key] = t.id;
    }
  });
});

describe('a Super Admin from admin scope', () => {
  it('sets the legal name and the sealed EIN of an ACTIVE firm, with one audit row of field names', async () => {
    const after = await apply(asAdmin);
    expect(after).toEqual({ scope: 'admin', firm: '' });

    const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.findUniqueOrThrow({ where: { id: f.firmA }, select: { legalName: true } }),
    );
    expect(firm.legalName).toBe('Fake Firm A Legal LLC');
    const settings = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.businessSettings.findUniqueOrThrow({ where: { businessId: f.firmA } }),
    );
    expect(Buffer.from(settings.einEnc!)).toEqual(SEALED);
    expect(settings.einLast4).toBe('4321');

    const rows = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: f.firmA, action: 'settings.profile_change_applied' },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: superAdmin,
      entityType: 'support_ticket',
      entityId: ids.ticketA,
      metadata: { fields: ['legalName', 'ein'] },
    });
  });

  it('applies the legal name alone, or the EIN alone', async () => {
    await apply(asAdmin, { einEnc: null, last4: null, fields: ['legalName'] });
    await apply(asAdmin, { legalName: null, fields: ['ein'] });
  });
});

describe('who may call it, for which firm', () => {
  it('refuses a firm’s scope, the platform scope, a person, and anyone but a Super Admin', async () => {
    const notAdmin = randomUUID();
    for (const scope of [
      { kind: 'business', businessId: f.firmA },
      { kind: 'platform' },
      { kind: 'user', userId: f.memberA },
      { kind: 'admin', adminUserId: notAdmin },
      { kind: 'admin', adminUserId: f.memberA },
    ] as Scope[]) {
      expect(await failure(apply(scope)), JSON.stringify(scope)).toMatch(/only a Super Admin/);
    }
  });

  it('refuses another firm’s ticket and a firm that is not ACTIVE', async () => {
    expect(await failure(apply(asAdmin, { ticket: ids.ticketB }))).toMatch(/no such ticket/);
    expect(await failure(apply(asAdmin, { business: f.firmB, ticket: ids.ticketB }))).toMatch(
      /only for an ACTIVE firm/,
    );
  });
});

describe('what it takes', () => {
  it('needs something to apply, the EIN sealed with its last 4 digits, a tidy legal name', async () => {
    for (const args of [
      { legalName: null, einEnc: null, last4: null, fields: [] },
      { last4: null },
      { einEnc: null },
      { last4: '12a4' },
      { einEnc: Buffer.alloc(0) },
      { legalName: '   ' },
      { legalName: 'x'.repeat(201) },
      { legalName: 'Fake\u0007LLC' },
    ]) {
      expect(await failure(apply(asAdmin, args)), JSON.stringify(args)).toMatch(
        /nothing valid to apply/,
      );
    }
  });

  it('takes field names that match what is applied, so no value reaches the audit row', async () => {
    for (const fields of [
      ['123456789'],
      ['legalName'],
      ['legalName', 'ein', 'ein'],
      ['legalName', '12-3456789'],
      null,
    ]) {
      expect(await failure(apply(asAdmin, { fields })), JSON.stringify(fields)).toMatch(
        /nothing valid to apply/,
      );
    }
    const rows = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({ where: { action: 'settings.profile_change_applied' } }),
    );
    // Field names only: never the EIN, its digits or the sealed bytes.
    const text = JSON.stringify(rows.map((r) => r.metadata));
    expect(text).not.toMatch(/\d{4}/);
    expect(text).not.toContain(SEALED.toString('base64'));
    for (const r of rows) {
      expect(Object.keys((r.metadata as Record<string, unknown>) ?? {})).toEqual(['fields']);
    }
  });
});
