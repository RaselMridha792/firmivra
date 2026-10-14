// R36 (Settings, r36_messages_portal_branding): Company Profile and Branding: the new settings
// columns, the email, portal and document brand profile, and the published brand versions. Runs as
// the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const key = (firm: string, name = 'brand/x.png') => `tenant/${firm}/${name}`;
const setSettings = (data: Record<string, unknown>) =>
  firmA().businessSettings.upsert({
    where: { businessId: f.firmA },
    create: { ...A(), ...data },
    update: data,
  });
const setProfile = (data: Record<string, unknown>) =>
  firmA().businessBrandProfile.upsert({
    where: { businessId: f.firmA },
    create: { ...A(), ...data },
    update: data,
  });
const publish = (version: number, data: Record<string, unknown> = {}) =>
  firmA().businessBrandVersion.create({
    data: { ...A(), version, snapshot: { primary: '#0A3D91' }, publishedByUserId: staff, ...data },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'br');
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@br.test`,
        name: 'Fake Staff',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.membership.create({ data: { ...A(), userId: staff, role: 'OWNER', status: 'ACTIVE' } }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('business settings branding columns', () => {
  it("have the screens' defaults: light theme, solid left sidebar, US English, dollars, month first", async () => {
    expect(await setSettings({})).toMatchObject({
      theme: 'LIGHT',
      sidebarStyle: 'SOLID',
      sidebarPosition: 'LEFT',
      showLogoText: true,
      roundedCorners: true,
      locale: 'en-US',
      currency: 'usd',
      dateFormat: 'MDY',
      brandingVersion: 1,
      faviconKey: null,
      supportEmail: null,
    });
  });

  it('take colours as #rrggbb, a theme and layout choices', async () => {
    await expect(
      setSettings({
        secondaryColor: '#D4AF37',
        backgroundColor: '#F5F8FF',
        theme: 'DARK',
        sidebarStyle: 'GRADIENT',
        sidebarPosition: 'RIGHT',
      }),
    ).resolves.toBeTruthy();
    await expect(setSettings({ secondaryColor: 'gold' })).rejects.toThrow(/check constraint/i);
    await expect(setSettings({ backgroundColor: '#FFF' })).rejects.toThrow(/check constraint/i);
  });

  it("keep asset keys under the firm's own prefix", async () => {
    await expect(
      setSettings({
        faviconKey: key(f.firmA, 'brand/favicon.png'),
        loginBackgroundKey: key(f.firmA, 'brand/bg.jpg'),
      }),
    ).resolves.toBeTruthy();
    await expect(setSettings({ faviconKey: key(f.firmB, 'brand/favicon.png') })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(setSettings({ loginBackgroundKey: 'public/bg.jpg' })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('bound the login message, industry, locale, currency and support email', async () => {
    await expect(setSettings({ loginMessage: 'x'.repeat(201) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(setSettings({ industry: 'x'.repeat(81) })).rejects.toThrow(/check constraint/i);
    await expect(setSettings({ locale: 'english' })).rejects.toThrow(/check constraint/i);
    await expect(setSettings({ currency: 'USD' })).rejects.toThrow(/check constraint/i);
    await expect(setSettings({ supportEmail: 'Support@Firm.test' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(setSettings({ supportEmail: 'not an email' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(setSettings({ brandingVersion: 0 })).rejects.toThrow(/check constraint/i);
    await expect(
      setSettings({
        loginMessage: 'Welcome. Your trusted partner.',
        industry: 'Accounting & Tax Services',
        supportEmail: 'support@firm.test',
        locale: 'es-US',
        currency: 'cad',
        dateFormat: 'DMY',
      }),
    ).resolves.toBeTruthy();
  });
});

describe('brand profile', () => {
  it('is one row per firm, with email, portal and document branding', async () => {
    const row = await setProfile({
      emailFromName: 'LVP Accounting',
      replyToEmail: 'help@firm.test',
      emailFooter: 'Footer',
      portalBrandColor: '#0A3D91',
      letterheadHeader: 'LVP',
      legalText: 'Legal',
      updatedByUserId: staff,
    });
    expect(row.businessId).toBe(f.firmA);
    await expect(firmA().businessBrandProfile.create({ data: { ...A() } })).rejects.toThrow(
      /unique/i,
    );
  });

  it('bound the texts, colours, keys and the reply-to address', async () => {
    await expect(setProfile({ emailHeader: 'x'.repeat(501) })).rejects.toThrow(/check constraint/i);
    await expect(setProfile({ legalText: 'x'.repeat(2001) })).rejects.toThrow(/check constraint/i);
    await expect(setProfile({ portalAccentColor: 'blue' })).rejects.toThrow(/check constraint/i);
    await expect(setProfile({ emailLogoKey: key(f.firmB) })).rejects.toThrow(/check constraint/i);
    await expect(
      setProfile({
        portalLogoKey: key(f.firmA, 'brand/portal.png'),
        emailLogoKey: key(f.firmA, 'brand/email.png'),
      }),
    ).resolves.toBeTruthy();
    await expect(setProfile({ replyToEmail: 'HELP@firm.test' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(setProfile({ updatedByUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
  });
});

describe('brand versions', () => {
  it('are numbered 1, 2, 3 in order and never changed or deleted', async () => {
    const v1 = await publish(1);
    await expect(publish(1)).rejects.toThrow(/next version|unique/i);
    await expect(publish(3)).rejects.toThrow(/next version/);
    await expect(publish(2)).resolves.toBeTruthy();
    await expect(
      firmA().businessBrandVersion.update({ where: { id: v1.id }, data: { version: 9 } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().businessBrandVersion.deleteMany({ where: { id: v1.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('hold an object of bounded size, published by a member of the firm', async () => {
    await expect(publish(3, { snapshot: ['a'] })).rejects.toThrow(/check constraint/i);
    await expect(publish(3, { snapshot: { big: 'x'.repeat(33000) } })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(publish(3, { publishedByUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(publish(3)).resolves.toBeTruthy();
  });

  it('numbering is per firm', async () => {
    await expect(
      firmB().businessBrandVersion.create({
        data: { businessId: f.firmB, version: 1, snapshot: {} },
      }),
    ).resolves.toBeTruthy();
  });
});

describe('isolation between firms', () => {
  it("settings stay the firm's own; the profile and versions are invisible to another firm", async () => {
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      await tx.businessBrandProfile.create({ data: { businessId: f.firmB } });
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, [
      'business_brand_profiles',
      'business_brand_versions',
    ]);
    await expect(firmB().businessBrandProfile.create({ data: { ...A() } })).rejects.toThrow(
      /row-level security|unique/i,
    );
    await expect(
      firmB().businessSettings.update({ where: { businessId: f.firmA }, data: { theme: 'DARK' } }),
    ).rejects.toThrow();
  });
});
