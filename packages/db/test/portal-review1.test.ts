// Client Portal Review One (R1, migration r1_portal_review1, Rasel's approval of Nov 18): the
// portal's tabs (built-in labels and order, custom tabs and who sees them), the announcement
// switches and channel policy, the landing page's button text, and an advisory plan's client
// approval. Every new row is its own firm's; runs as the app role under RLS. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { expectInvisibleToOtherFirm } from './r36-helpers.js';
import { failure } from './r38-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const unscopedApp = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);
const run = randomUUID().slice(0, 8);
const firm = { a: '', b: '' };
const client = { a: '', b: '' };
const tag = { a: '' };
const clientUser = randomUUID();

const tab = (
  key: 'a' | 'b',
  data: Partial<{
    kind: 'BUILT_IN' | 'CUSTOM';
    module: 'DOCUMENTS' | 'BUSINESS_RESOURCES' | 'TAX_RETURNS' | 'MESSAGES';
    label: string | null;
    sortOrder: number;
    enabled: boolean;
    audience: 'ALL' | 'TAGS' | 'CLIENTS';
    archivedAt: Date | null;
  }>,
) =>
  db.forBusiness(firm[key]).portalTab.create({
    data: {
      businessId: firm[key],
      kind: data.kind ?? 'CUSTOM',
      module: data.module ?? 'DOCUMENTS',
      label: data.label === undefined ? `Payroll Documents ${randomUUID().slice(0, 6)}` : data.label,
      sortOrder: data.sortOrder ?? 7,
      ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
      ...(data.audience === undefined ? {} : { audience: data.audience }),
      ...(data.archivedAt === undefined ? {} : { archivedAt: data.archivedAt }),
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: clientUser,
        cognitoSub: clientUser,
        pool: 'CLIENT',
        email: `${clientUser}@portal.test`,
        name: 'Fake',
      },
    });
    firm.a = (await tx.business.create({ data: { slug: `cpr-a-${run}`, name: 'A' } })).id;
    firm.b = (await tx.business.create({ data: { slug: `cpr-b-${run}`, name: 'B' } })).id;
  });
  for (const key of ['a', 'b'] as const) {
    client[key] = await runInScope(owner, { kind: 'business', businessId: firm[key] }, async (tx) => {
      const c = await tx.client.create({ data: { businessId: firm[key], displayName: 'Fake' } });
      if (key === 'a') {
        tag.a = (await tx.tag.create({ data: { businessId: firm.a, name: `Payroll ${run}` } })).id;
      }
      return c.id;
    });
  }
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), unscopedApp.$disconnect(), db.disconnect()]);
});

describe('portal_tabs and portal_tab_targets', () => {
  it("keeps a firm's tabs and targets from every other firm", async () => {
    const mine = await tab('a', {});
    await db.forBusiness(firm.a).portalTabTarget.create({
      data: { businessId: firm.a, portalTabId: mine.id, clientId: client.a },
    });
    const theirs = await tab('b', {});
    await db.forBusiness(firm.b).portalTabTarget.create({
      data: { businessId: firm.b, portalTabId: theirs.id, clientId: client.b },
    });
    await expectInvisibleToOtherFirm(unscopedApp, firm.a, firm.b, [
      'portal_tabs',
      'portal_tab_targets',
    ]);
    // Firm B can't aim its tab at firm A's client, nor write into firm A.
    expect(
      await failure(
        db.forBusiness(firm.b).portalTabTarget.create({
          data: { businessId: firm.b, portalTabId: theirs.id, clientId: client.a },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(
      await failure(
        db.forBusiness(firm.b).portalTab.create({
          data: { businessId: firm.a, kind: 'CUSTOM', module: 'DOCUMENTS', label: 'X', sortOrder: 1 },
        }),
      ),
    ).toMatch(/row-level security/i);
  });

  it('a custom tab has a label and reuses document upload or business resources', async () => {
    expect((await tab('a', { module: 'BUSINESS_RESOURCES' })).module).toBe('BUSINESS_RESOURCES');
    expect(await failure(tab('a', { label: null }))).toMatch(/check constraint/i);
    expect(await failure(tab('a', { module: 'TAX_RETURNS' }))).toMatch(/check constraint/i);
    for (const label of ['', '   ', 'x'.repeat(41), 'hidden​space']) {
      expect(await failure(tab('a', { label })), JSON.stringify(label)).toMatch(/check constraint/i);
    }
    expect(await failure(tab('a', { sortOrder: -1 }))).toMatch(/check constraint/i);
  });

  it('a built-in tab is only a label and a position, once per tab', async () => {
    const built = await tab('a', { kind: 'BUILT_IN', module: 'MESSAGES', label: null, sortOrder: 5 });
    expect(built).toMatchObject({ label: null, enabled: true, audience: 'ALL' });
    expect(
      await failure(tab('a', { kind: 'BUILT_IN', module: 'MESSAGES', label: 'Notes', sortOrder: 1 })),
    ).toMatch(/unique constraint/i);
    for (const extra of [{ enabled: false }, { audience: 'TAGS' as const }, { archivedAt: new Date() }]) {
      expect(
        await failure(tab('a', { kind: 'BUILT_IN', module: 'TAX_RETURNS', label: null, ...extra })),
        JSON.stringify(extra),
      ).toMatch(/check constraint/i);
    }
  });

  it('labels are unique among live tabs, ignoring case; an archived tab frees its label', async () => {
    const first = await tab('a', { label: `Receipts ${run}` });
    expect(await failure(tab('a', { label: `  receipts ${run.toUpperCase()} ` }))).toMatch(
      /unique constraint/i,
    );
    await db
      .forBusiness(firm.a)
      .portalTab.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
    expect((await tab('a', { label: `Receipts ${run}` })).label).toBe(`Receipts ${run}`);
  });

  it('tabs are archived, never deleted; a target is one tag or one client, once', async () => {
    const t = await tab('a', { audience: 'TAGS' });
    expect(
      await failure(db.forBusiness(firm.a).portalTab.delete({ where: { id: t.id } })),
    ).toMatch(/permission denied/i);
    const target = (data: { clientId?: string; tagId?: string }) =>
      db.forBusiness(firm.a).portalTabTarget.create({
        data: { businessId: firm.a, portalTabId: t.id, ...data },
      });
    await target({ tagId: tag.a });
    expect(await failure(target({ tagId: tag.a }))).toMatch(/unique constraint/i);
    expect(await failure(target({}))).toMatch(/check constraint/i);
    expect(await failure(target({ tagId: tag.a, clientId: client.a }))).toMatch(/check constraint/i);
  });
});

describe('client_portal_settings and business_settings', () => {
  it('announcements are on by default, and texts can never be required', async () => {
    const s = await db.forBusiness(firm.a).clientPortalSettings.create({
      data: { businessId: firm.a },
    });
    expect(s).toMatchObject({
      announcementsEnabled: true,
      announcementEmailPolicy: 'CLIENT_CHOICE',
      announcementSmsPolicy: 'CLIENT_CHOICE',
      announcementsOnDashboard: true,
    });
    expect(
      await failure(
        db.forBusiness(firm.a).clientPortalSettings.update({
          where: { businessId: firm.a },
          data: { announcementSmsPolicy: 'REQUIRED' },
        }),
      ),
    ).toMatch(/check constraint/i);
    expect(
      (
        await db.forBusiness(firm.a).clientPortalSettings.update({
          where: { businessId: firm.a },
          data: { announcementEmailPolicy: 'REQUIRED', announcementSmsPolicy: 'OFF' },
        })
      ).announcementEmailPolicy,
    ).toBe('REQUIRED');
  });

  it('the button text is one short line, or the default', async () => {
    const settings = db.forBusiness(firm.b).businessSettings;
    await settings.create({ data: { businessId: firm.b } });
    const set = (portalSignInLabel: string | null) =>
      settings.update({ where: { businessId: firm.b }, data: { portalSignInLabel } });
    expect((await set('Log in')).portalSignInLabel).toBe('Log in');
    expect((await set(null)).portalSignInLabel).toBeNull();
    for (const label of ['', 'x'.repeat(31), 'two\nlines']) {
      expect(await failure(set(label)), JSON.stringify(label)).toMatch(/check constraint/i);
    }
  });
});

describe('advisory_plans client approval', () => {
  it('is all three facts or none, of a real version, and a client may await approval', async () => {
    const plan = await runInScope(owner, { kind: 'business', businessId: firm.a }, async (tx) => {
      const member = randomUUID();
      await tx.user.create({
        data: { id: member, cognitoSub: member, pool: 'STAFF', email: `${member}@a.test`, name: 'F' },
      });
      await tx.membership.create({
        data: { businessId: firm.a, userId: member, role: 'OWNER', status: 'ACTIVE' },
      });
      const advisory = await tx.advisoryClient.create({
        data: { businessId: firm.a, clientId: client.a },
      });
      return tx.advisoryPlan.create({
        data: {
          businessId: firm.a,
          advisoryClientId: advisory.id,
          name: 'Growth (fake)',
          targetYear: 2027,
          createdByUserId: member,
        },
      });
    });
    const approve = (data: object) =>
      db.forBusiness(firm.a).advisoryPlan.update({ where: { id: plan.id }, data });
    expect((await approve({ status: 'AWAITING_CLIENT_APPROVAL' })).status).toBe(
      'AWAITING_CLIENT_APPROVAL',
    );
    expect(await failure(approve({ clientApprovedAt: new Date() }))).toMatch(/check constraint/i);
    expect(
      await failure(
        approve({ clientApprovedAt: new Date(), clientApprovedByUserId: clientUser, clientApprovedVersion: 0 }),
      ),
    ).toMatch(/check constraint/i);
    const approved = await approve({
      clientApprovedAt: new Date(),
      clientApprovedByUserId: clientUser,
      clientApprovedVersion: 1,
    });
    expect(approved.clientApprovedVersion).toBe(1);
  });
});
