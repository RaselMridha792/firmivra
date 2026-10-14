// R36 (Services and Pricing, r36_promotions): Discounts and Promotions, what each applies to and
// where each was used. Runs as the app role under RLS.
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
let otherClient = '';
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
const promo = (data: Record<string, unknown> = {}) =>
  firmA().promotion.create({
    data: {
      ...A(),
      name: `Promotion ${++count}`,
      discountType: 'PERCENT',
      discountPercent: 10,
      status: 'ACTIVE',
      ...data,
    },
  });
const invoice = (clientId = f.client) =>
  firmA().invoice.create({ data: { ...A(), clientId, number: `INV-${++count}` } });
const redeem = (promotionId: string, invoiceId: string, data: Record<string, unknown> = {}) =>
  firmA().promotionRedemption.create({
    data: { ...A(), promotionId, invoiceId, clientId: f.client, discountCents: 1000, ...data },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'pr');
  otherClient = (
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { ...A(), displayName: 'Other' } }),
    )
  ).id;
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('promotions', () => {
  it('start as drafts for everyone, with no stacking', async () => {
    expect(await promo({ status: undefined })).toMatchObject({
      status: 'DRAFT',
      appliesTo: 'ALL',
      eligibility: 'ALL_CLIENTS',
      allowStacking: false,
      promoCode: null,
    });
  });

  it('are a percentage or a fixed amount above zero, with its one value', async () => {
    await expect(promo({ discountPercent: null })).rejects.toThrow(/check constraint/i);
    await expect(promo({ discountPercent: 0 })).rejects.toThrow(/check constraint/i);
    await expect(promo({ discountPercent: 101 })).rejects.toThrow(/check constraint/i);
    await expect(
      promo({ discountType: 'FIXED', discountPercent: null, discountCents: 5000 }),
    ).resolves.toBeTruthy();
    await expect(promo({ discountType: 'FIXED', discountPercent: null })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      promo({ discountType: 'FIXED', discountPercent: null, discountCents: 0 }),
    ).rejects.toThrow(/check constraint/i);
    await expect(promo({ discountType: 'FIXED', discountCents: 5000 })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('have a window that ends after it starts, and a unique code in upper case', async () => {
    await expect(promo({ startsAt: hours(2), endsAt: hours(1) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(promo({ startsAt: hours(1), endsAt: hours(2) })).resolves.toBeTruthy();
    await expect(promo({ startsAt: hours(1) })).resolves.toBeTruthy();
    const code = `SAVE${f.run}`.toUpperCase();
    await promo({ promoCode: code });
    await expect(promo({ promoCode: code })).rejects.toThrow(/unique/i);
    await expect(promo({ promoCode: 'save10' })).rejects.toThrow(/check constraint/i);
    await expect(promo({ promoCode: 'A' })).rejects.toThrow(/check constraint/i);
    await expect(promo({ promoCode: 'WITH SPACE' })).rejects.toThrow(/check constraint/i);
    await expect(
      firmB().promotion.create({
        data: {
          businessId: f.firmB,
          name: 'B',
          discountType: 'PERCENT',
          discountPercent: 5,
          promoCode: code,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('keep their name bounded and are never deleted by the app', async () => {
    await expect(promo({ name: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(promo({ description: 'x'.repeat(501) })).rejects.toThrow(/check constraint/i);
    const p = await promo();
    await expect(firmA().promotion.deleteMany({ where: { id: p.id } })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      firmA().promotion.update({ where: { id: p.id }, data: { status: 'INACTIVE' } }),
    ).resolves.toBeTruthy();
  });
});

describe('promotion targets', () => {
  it("are of the promotion's kind, one each, listed once; a promotion for all has none", async () => {
    const category = await firmA().serviceCategory.create({ data: { ...A(), name: `C ${f.run}` } });
    const service = await firmA().service.create({
      data: { ...A(), kind: 'OTHER', name: `S ${f.run}` },
    });
    const pkg = await firmA().servicePackage.create({
      data: { ...A(), name: `P ${f.run}`, shortDescription: 'p' },
    });
    const target = (promotionId: string, data: Record<string, unknown>) =>
      firmA().promotionTarget.create({ data: { ...A(), promotionId, ...data } });
    const byCategory = await promo({ appliesTo: 'CATEGORIES' });
    await expect(target(byCategory.id, { categoryId: category.id })).resolves.toBeTruthy();
    await expect(target(byCategory.id, { categoryId: category.id })).rejects.toThrow(/unique/i);
    await expect(target(byCategory.id, { serviceId: service.id })).rejects.toThrow(/kind/);
    await expect(target(byCategory.id, {})).rejects.toThrow(/kind/);
    await expect(
      target(byCategory.id, { categoryId: category.id, serviceId: service.id }),
    ).rejects.toThrow(/check constraint/i);
    const bySvc = await promo({ appliesTo: 'SERVICES' });
    await expect(target(bySvc.id, { serviceId: service.id })).resolves.toBeTruthy();
    const byPkg = await promo({ appliesTo: 'PACKAGES' });
    await expect(target(byPkg.id, { packageId: pkg.id })).resolves.toBeTruthy();
    const all = await promo();
    await expect(target(all.id, { packageId: pkg.id })).rejects.toThrow(/kind/);
  });

  it("cannot point at another firm's category, service or package", async () => {
    const theirs = await firmB().serviceCategory.create({
      data: { businessId: f.firmB, name: `T ${f.run}` },
    });
    const p = await promo({ appliesTo: 'CATEGORIES' });
    await expect(
      firmA().promotionTarget.create({
        data: { ...A(), promotionId: p.id, categoryId: theirs.id },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('promotion redemptions', () => {
  it("record a live promotion used on the client's own invoice, once, and never change", async () => {
    const p = await promo();
    const inv = await invoice();
    const r = await redeem(p.id, inv.id);
    expect(r.discountCents).toBe(1000);
    await expect(redeem(p.id, inv.id)).rejects.toThrow(/unique/i);
    await expect(redeem(p.id, (await invoice(otherClient)).id)).rejects.toThrow(/this client/);
    await expect(redeem(p.id, (await invoice()).id, { discountCents: 0 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      firmA().promotionRedemption.update({ where: { id: r.id }, data: { discountCents: 1 } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().promotionRedemption.deleteMany({ where: { id: r.id } })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      firmA().promotion.count({ where: { redemptions: { some: {} } } }),
    ).resolves.toBeGreaterThan(0);
  });

  it('are refused for a draft, an ended, a scheduled or an expired promotion', async () => {
    const inv = await invoice();
    for (const data of [
      { status: 'DRAFT' },
      { status: 'INACTIVE' },
      { startsAt: hours(1) },
      { startsAt: hours(-3), endsAt: hours(-1) },
    ]) {
      const p = await promo(data);
      await expect(redeem(p.id, inv.id)).rejects.toThrow(/live promotion/);
    }
    await expect(
      redeem((await promo({ startsAt: hours(-1), endsAt: hours(1) })).id, inv.id),
    ).resolves.toBeTruthy();
  });

  it('do not stack on one invoice unless both promotions allow it', async () => {
    const inv = await invoice();
    const first = await promo({ allowStacking: true });
    await redeem(first.id, inv.id);
    await expect(redeem((await promo()).id, inv.id)).rejects.toThrow(/do not stack/);
    await expect(redeem((await promo({ allowStacking: true })).id, inv.id)).resolves.toBeTruthy();
    const inv2 = await invoice();
    await redeem((await promo()).id, inv2.id);
    await expect(redeem((await promo({ allowStacking: true })).id, inv2.id)).rejects.toThrow(
      /do not stack/,
    );
  });

  it("use the firm's own promotion and invoice", async () => {
    const theirs = await firmB().promotion.create({
      data: {
        businessId: f.firmB,
        name: `B ${f.run}`,
        discountType: 'PERCENT',
        discountPercent: 5,
        status: 'ACTIVE',
      },
    });
    await expect(redeem(theirs.id, (await invoice()).id)).rejects.toThrow(
      /foreign key|live promotion/i,
    );
    await expect(redeem(randomUUID(), (await invoice()).id)).rejects.toThrow(
      /foreign key|live promotion/i,
    );
  });
});

describe('isolation between firms', () => {
  it('promotions, targets and redemptions are invisible to another firm', async () => {
    const p = await promo({ appliesTo: 'CATEGORIES' });
    const category = await firmA().serviceCategory.create({
      data: { ...A(), name: `Iso ${f.run}` },
    });
    await firmA().promotionTarget.create({
      data: { ...A(), promotionId: p.id, categoryId: category.id },
    });
    await redeem((await promo()).id, (await invoice()).id);
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const bp = await tx.promotion.create({
        data: {
          businessId: f.firmB,
          name: `B2 ${f.run}`,
          discountType: 'PERCENT',
          discountPercent: 5,
          status: 'ACTIVE',
          appliesTo: 'CATEGORIES',
        },
      });
      const bc = await tx.serviceCategory.create({
        data: { businessId: f.firmB, name: `B2 ${f.run}` },
      });
      await tx.promotionTarget.create({
        data: { businessId: f.firmB, promotionId: bp.id, categoryId: bc.id },
      });
      const client = await tx.client.create({ data: { businessId: f.firmB, displayName: 'B' } });
      const inv = await tx.invoice.create({
        data: { businessId: f.firmB, clientId: client.id, number: 'B-1' },
      });
      await tx.promotionRedemption.create({
        data: {
          businessId: f.firmB,
          promotionId: bp.id,
          invoiceId: inv.id,
          clientId: client.id,
          discountCents: 5,
        },
      });
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, [
      'promotions',
      'promotion_targets',
      'promotion_redemptions',
    ]);
    await expect(
      firmB().promotion.create({
        data: { ...A(), name: 'Sneaky', discountType: 'PERCENT', discountPercent: 1 },
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
