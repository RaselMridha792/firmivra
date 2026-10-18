// R0 stage B7 (Oct 18): Super Admin System Settings. Versioned sections with floors, secret
// references (never values; SUPER_ADMIN only), versioned brand assets, feature flags with firm
// overrides, retention policies with floors (SUPER_ADMIN only), legal holds, retention runs,
// maintenance windows, job controls and versioned default sets. No firm scope reaches any of it.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { ceo: randomUUID(), member: randomUUID(), firm: '' };

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>, adminUserId = ids.ceo) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asMember = <T>(fn: (tx: TxClient) => Promise<T>) => asAdmin(fn, ids.member);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.ceo, ids.member]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceo, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.member, role: 'TEAM_MEMBER' } });
    const code = run.toUpperCase();
    const dept = await tx.platformDepartment.create({ data: { code: `B7_${code}`, name: 'Ops' } });
    const ceoRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B7_CEO_${code}`,
        title: 'CEO',
        level: 'CEO',
        departmentId: dept.id,
        defaultScopeType: 'COMPANY',
      },
    });
    const opsRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B7_OPS_${code}`,
        title: 'Operations',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultReportsToRoleId: ceoRole.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
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
        roleDefinitionId: opsRole.id,
        departmentId: dept.id,
        reportsToUserId: ids.ceo,
        scopeType: 'OWN_RECORDS',
      },
    });
    ids.firm = (await tx.business.create({ data: { slug: `b7-${run}`, name: 'Firm' } })).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

describe('system settings: who reaches it', () => {
  it('the team and the platform read it; no firm does', async () => {
    expect(await asPlatform((tx) => tx.platformSetting.count())).toBe(3);
    expect(await asMember((tx) => tx.platformRetentionPolicy.count())).toBeGreaterThan(0);
    expect(await asFirm((tx) => tx.platformSetting.count())).toBe(0);
    expect(await asFirm((tx) => tx.platformFeature.count())).toBe(0);
  });

  it('secret references and retention policies are written only by a SUPER_ADMIN', async () => {
    const ref = { key: `email.smtp_${run}`, reference: 'local:smtp-password' };
    expect(await outcome(asMember((tx) => tx.platformSecretRef.create({ data: ref })))).toMatch(
      /row-level security/,
    );
    await asAdmin((tx) => tx.platformSecretRef.create({ data: ref }));
    expect(
      await asMember((tx) =>
        tx.platformRetentionPolicy.updateMany({
          where: { category: 'communications' },
          data: { retentionDays: 2000 },
        }),
      ),
    ).toEqual({ count: 0 });
  });
});

describe('system settings: sections', () => {
  it('every save is a new version, stamped; a stale save finds nothing; nobody adds a section', async () => {
    const before = await asMember((tx) =>
      tx.platformSetting.findUniqueOrThrow({ where: { key: 'general' } }),
    );
    const value = {
      ...(before.value as Record<string, unknown>),
      supportEmail: 'help@firmivra.test',
    };
    expect(
      await asMember((tx) =>
        tx.platformSetting.updateMany({
          where: { key: 'general', version: before.version },
          data: { value },
        }),
      ),
    ).toEqual({ count: 1 });
    const after = await asMember((tx) =>
      tx.platformSetting.findUniqueOrThrow({ where: { key: 'general' } }),
    );
    expect(after).toMatchObject({ version: before.version + 1, updatedByUserId: ids.member });
    expect(
      await asMember((tx) =>
        tx.platformSetting.updateMany({
          where: { key: 'general', version: before.version },
          data: { value },
        }),
      ),
    ).toEqual({ count: 0 });
    expect(
      await outcome(
        asAdmin((tx) => tx.platformSetting.create({ data: { key: 'extra', value: {} } })),
      ),
    ).toMatch(/permission denied/i);
  });

  it("keeps each section's floors", async () => {
    const current = async (key: string) =>
      (await asAdmin((tx) => tx.platformSetting.findUniqueOrThrow({ where: { key } })))
        .value as Record<string, unknown>;
    const general = await current('general');
    const branding = await current('branding');
    const email = await current('email_notifications');
    for (const [key, value] of [
      ['general', { ...general, platformName: ' ' }],
      ['general', { ...general, defaultTimeZone: 'Mars/Olympus' }],
      ['general', { ...general, defaultCurrency: 'usd' }],
      ['general', { ...general, supportEmail: 'not-an-email' }],
      ['branding', { ...branding, primaryAccent: 'blue' }],
      ['branding', { ...branding, appearance: 'NEON' }],
      ['email_notifications', { ...email, maxRetries: 50 }],
      ['email_notifications', { ...email, fromEmail: 'nope' }],
    ] as const) {
      expect(
        await outcome(
          asAdmin((tx) => tx.platformSetting.update({ where: { key }, data: { value } })),
        ),
      ).toMatch(/platform_settings_values/);
    }
  });
});

describe('system settings: secrets, branding and features', () => {
  it('a secret is a reference, never a value; a new reference is a rotation', async () => {
    const key = `sms.token_${run}`;
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformSecretRef.create({
            data: { key, reference: 'my-plain-text-password' },
          }),
        ),
      ),
    ).toMatch(/platform_secret_refs_values/);
    const created = await asAdmin((tx) =>
      tx.platformSecretRef.create({
        data: {
          key,
          reference: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:firmivra/sms-AbCdEf',
        },
      }),
    );
    const rotated = await asAdmin((tx) =>
      tx.platformSecretRef.update({
        where: { key },
        data: {
          reference: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:firmivra/sms-GhIjKl',
        },
      }),
    );
    expect(rotated.rotatedAt!.getTime()).toBeGreaterThanOrEqual(created.rotatedAt!.getTime());
    expect(rotated.updatedByUserId).toBe(ids.ceo);
  });

  it('brand assets: raster only, scanned once by the platform; the one in use is clean and of its kind', async () => {
    const asset = (kind: 'LOGO' | 'FAVICON', contentType: string) => {
      const id = randomUUID();
      return asAdmin((tx) =>
        tx.platformBrandAsset.create({
          data: {
            id,
            kind,
            fileName: 'mark.png',
            contentType,
            sizeBytes: 1024,
            sha256: createHash('sha256').update(id).digest('hex'),
            s3Key: `platform/branding/${id}/mark.png`,
          },
        }),
      );
    };
    expect(await outcome(asset('LOGO', 'image/svg+xml'))).toMatch(/platform_brand_assets_values/);
    const logo = await asset('LOGO', 'image/png');
    const icon = await asset('FAVICON', 'image/png');
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformBrandAsset.update({ where: { id: logo.id }, data: { scanStatus: 'CLEAN' } }),
        ),
      ),
    ).toMatch(/only the scanner/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformBrandCurrent.upsert({
            where: { kind: 'LOGO' },
            create: { kind: 'LOGO', assetId: logo.id },
            update: { assetId: logo.id },
          }),
        ),
      ),
    ).toMatch(/clean LOGO asset/);
    await asPlatform((tx) =>
      tx.platformBrandAsset.update({ where: { id: logo.id }, data: { scanStatus: 'CLEAN' } }),
    );
    await asPlatform((tx) =>
      tx.platformBrandAsset.update({ where: { id: icon.id }, data: { scanStatus: 'CLEAN' } }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformBrandAsset.update({
            where: { id: logo.id },
            data: { scanStatus: 'INFECTED' },
          }),
        ),
      ),
    ).toMatch(/only the scanner records a scan, once/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformBrandCurrent.upsert({
            where: { kind: 'LOGO' },
            create: { kind: 'LOGO', assetId: icon.id },
            update: { assetId: icon.id },
          }),
        ),
      ),
    ).toMatch(/clean LOGO asset/);
    await asAdmin((tx) =>
      tx.platformBrandCurrent.upsert({
        where: { kind: 'LOGO' },
        create: { kind: 'LOGO', assetId: logo.id },
        update: { assetId: logo.id },
      }),
    );
  });

  it('features: known dependencies, stable keys, and a feature others need stays', async () => {
    const base = `b7.base_${run}`;
    const child = `b7.child_${run}`;
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformFeature.create({ data: { key: child, name: 'Child', dependsOn: [base] } }),
        ),
      ),
    ).toMatch(/unknown feature/);
    await asAdmin((tx) =>
      tx.platformFeature.create({ data: { key: base, name: 'Base', defaultState: 'ON' } }),
    );
    await asAdmin((tx) =>
      tx.platformFeature.create({ data: { key: child, name: 'Child', dependsOn: [base] } }),
    );
    expect(
      await outcome(asAdmin((tx) => tx.platformFeature.delete({ where: { key: base } }))),
    ).toMatch(/other features depend/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformFeature.update({ where: { key: base }, data: { key: `${base}_x` } }),
        ),
      ),
    ).toMatch(/keeps its key/);
    const override = await asMember((tx) =>
      tx.platformFeatureOverride.create({
        data: { featureKey: child, businessId: ids.firm, state: 'ON' },
      }),
    );
    expect(override.updatedByUserId).toBe(ids.member);
  });
});

describe('system settings: retention, holds and runs', () => {
  it('a policy never goes below its floor; a change is a new version from now on', async () => {
    const p = await asAdmin((tx) =>
      tx.platformRetentionPolicy.findUniqueOrThrow({ where: { category: 'communications' } }),
    );
    for (const data of [{ retentionDays: p.minimumDays - 1 }, { minimumDays: 1 }]) {
      expect(
        await outcome(
          asAdmin((tx) =>
            tx.platformRetentionPolicy.update({ where: { category: 'communications' }, data }),
          ),
        ),
      ).toMatch(/platform_retention_policies_values|floor are fixed/);
    }
    const changed = await asAdmin((tx) =>
      tx.platformRetentionPolicy.update({
        where: { category: 'communications' },
        data: { retentionDays: p.retentionDays + 30, effectiveFrom: new Date('2020-01-01') },
      }),
    );
    expect(changed.version).toBe(p.version + 1);
    expect(changed.effectiveFrom.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('a hold covers one thing and is released once, with a reason', async () => {
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformLegalHold.create({
            data: {
              name: 'Two',
              reason: 'Both',
              category: 'communications',
              heldBusinessId: ids.firm,
            },
          }),
        ),
      ),
    ).toMatch(/platform_legal_holds_values/);
    const hold = await asMember((tx) =>
      tx.platformLegalHold.create({
        data: { name: 'Dispute', reason: 'Billing dispute', heldBusinessId: ids.firm },
      }),
    );
    expect(hold.createdByUserId).toBe(ids.member);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformLegalHold.update({ where: { id: hold.id }, data: { releasedAt: new Date() } }),
        ),
      ),
    ).toMatch(/platform_legal_holds_values/);
    const released = await asMember((tx) =>
      tx.platformLegalHold.update({
        where: { id: hold.id },
        data: { releasedAt: new Date('2020-01-01'), releaseReason: 'Dispute settled.' },
      }),
    );
    expect(released).toMatchObject({ releasedByUserId: ids.member });
    expect(released.releasedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformLegalHold.update({ where: { id: hold.id }, data: { releaseReason: 'Again' } }),
        ),
      ),
    ).toMatch(/released, once/);
  });

  it('runs: queued on the current policy; only the worker moves them; a dry run affects nothing', async () => {
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformRetentionRun.create({
            data: { category: 'no_such_category', policyVersion: 1 },
          }),
        ),
      ),
    ).toMatch(/no retention policy for no_such_category/);
    const r = await asMember((tx) =>
      tx.platformRetentionRun.create({ data: { category: 'export_files', policyVersion: 99 } }),
    );
    expect(r.policyVersion).toBe(1);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformRetentionRun.update({ where: { id: r.id }, data: { status: 'RUNNING' } }),
        ),
      ),
    ).toMatch(/cannot become RUNNING here/);
    await asPlatform((tx) =>
      tx.platformRetentionRun.update({ where: { id: r.id }, data: { status: 'RUNNING' } }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformRetentionRun.update({
            where: { id: r.id },
            data: { status: 'COMPLETED', eligibleCount: 3, affectedCount: 3 },
          }),
        ),
      ),
    ).toMatch(/platform_retention_runs_values/);
    await asPlatform((tx) =>
      tx.platformRetentionRun.update({
        where: { id: r.id },
        data: { status: 'COMPLETED', eligibleCount: 3 },
      }),
    );
    const c = await asMember((tx) =>
      tx.platformRetentionRun.create({ data: { category: 'export_files', policyVersion: 1 } }),
    );
    await asMember((tx) =>
      tx.platformRetentionRun.update({ where: { id: c.id }, data: { status: 'CANCELLED' } }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformRetentionRun.update({ where: { id: c.id }, data: { status: 'RUNNING' } }),
        ),
      ),
    ).toMatch(/a CANCELLED run never changes/);
  });
});

describe('system settings: maintenance, jobs and defaults', () => {
  it('a window is edited while scheduled; while active only its notice and end change', async () => {
    const start = new Date(Date.now() + 86_400_000);
    const w = await asMember((tx) =>
      tx.platformMaintenanceWindow.create({
        data: {
          title: 'Upgrade',
          message: 'Down for 30 minutes.',
          startsAt: start,
          endsAt: new Date(start.getTime() + 1_800_000),
        },
      }),
    );
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformMaintenanceWindow.update({ where: { id: w.id }, data: { endsAt: start } }),
        ),
      ),
    ).toMatch(/platform_maintenance_windows_values/);
    const active = await asMember((tx) =>
      tx.platformMaintenanceWindow.update({ where: { id: w.id }, data: { status: 'ACTIVE' } }),
    );
    expect(active.startedAt).not.toBeNull();
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformMaintenanceWindow.update({ where: { id: w.id }, data: { title: 'New' } }),
        ),
      ),
    ).toMatch(/only its notice and end/);
    await asMember((tx) =>
      tx.platformMaintenanceWindow.update({
        where: { id: w.id },
        data: { message: 'Running a little long.' },
      }),
    );
    const done = await asMember((tx) =>
      tx.platformMaintenanceWindow.update({ where: { id: w.id }, data: { status: 'COMPLETED' } }),
    );
    expect(done.endedAt).not.toBeNull();
  });

  it('the platform registers jobs and records runs; the team only pauses or resumes one', async () => {
    const jobKey = `b7.job_${run}`;
    expect(
      await outcome(
        asAdmin((tx) => tx.platformJobControl.create({ data: { jobKey, name: 'Job' } })),
      ),
    ).toMatch(/only the platform registers/);
    await asPlatform((tx) => tx.platformJobControl.create({ data: { jobKey, name: 'Job' } }));
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformJobControl.update({
            where: { jobKey },
            data: { lastStatus: 'COMPLETED', lastRunAt: new Date() },
          }),
        ),
      ),
    ).toMatch(/only pauses or resumes/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformJobControl.update({ where: { jobKey }, data: { pausedReason: 'Why' } }),
        ),
      ),
    ).toMatch(/platform_job_controls_values/);
    await expect(
      asAdmin((tx) =>
        tx.platformJobControl.update({
          where: { jobKey },
          data: { enabled: false, pausedReason: 'Provider outage.' },
        }),
      ),
    ).resolves.toMatchObject({ enabled: false, updatedByUserId: ids.ceo });
  });

  it('default sets are numbered versions that never change; a firm gets firm defaults once', async () => {
    const latest = await asAdmin((tx) =>
      tx.platformDefaultSet.findFirstOrThrow({
        where: { kind: 'USER' },
        orderBy: { version: 'desc' },
      }),
    );
    const next = await asAdmin((tx) =>
      tx.platformDefaultSet.create({
        data: { kind: 'USER', version: 1, values: { appearance: 'DARK' } },
      }),
    );
    expect(next.version).toBe(latest.version + 1);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformDefaultSet.update({ where: { id: next.id }, data: { note: 'Edited' } }),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformDefaultSetApplication.create({
            data: { businessId: ids.firm, defaultSetId: next.id },
          }),
        ),
      ),
    ).toMatch(/provisioned with firm defaults/);
  });
});
