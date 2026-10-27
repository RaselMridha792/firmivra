// Octavia's Tax Returns review, TX-F31/F32 (R1, Oct 26; migration r1_tax_business_identity): a
// BUSINESS return keeps the business's name, sealed EIN and address, copied by the database at
// creation from the client's own profile; frozen once filed. Runs as the app role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

// Synthetic sealed values in the shape sealed_value_ok accepts (as in client-ein-status.test.ts);
// no real EIN.
const sealed = (fill: number) =>
  Buffer.concat([Buffer.from([1, 1, 0, 8]), Buffer.alloc(8, fill), Buffer.alloc(32, 9)]);
const profile = {
  businessName: 'Fake Bakery LLC',
  einEnc: sealed(7),
  einLast4: '6789',
  addressLine1: '100 Test Street',
  addressLine2: 'Suite 2',
  city: 'Testville',
  state: 'GA',
  postalCode: '30301',
};
const snapshot = {
  businessName: 'Fake Bakery LLC',
  businessEinLast4: '6789',
  businessAddressLine1: '100 Test Street',
  businessAddressLine2: 'Suite 2',
  businessCity: 'Testville',
  businessState: 'GA',
  businessPostalCode: '30301',
};

const newReturn = (filingType: 'BUSINESS' | 'INDIVIDUAL', data: Record<string, unknown> = {}) =>
  A().taxReturn.create({
    data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2025, filingType, ...data },
  });
const save = (id: string, data: Record<string, unknown>) =>
  A().taxReturn.update({ where: { id }, data });
const editProfile = (data: Record<string, unknown>) =>
  A().clientProfile.update({ where: { clientId: f.clientA }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tbi');
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.clientProfile.create({ data: { businessId: f.firmA, clientId: f.clientA, ...profile } }),
  );
});

describe('a business return', () => {
  it("takes the client's name, sealed EIN and address at creation, not what was sent", async () => {
    const r = await newReturn('BUSINESS', { businessName: 'Typed By Hand Inc' });
    expect(r).toMatchObject(snapshot);
    expect(Buffer.from(r.businessEinEnc!)).toEqual(sealed(7));
  });

  it('keeps its snapshot when the profile changes; a new return takes the new profile', async () => {
    const before = await newReturn('BUSINESS');
    await editProfile({ businessName: 'Fake Bakery Holdings LLC', city: 'Newtown' });
    expect(await A().taxReturn.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject(
      snapshot,
    );
    expect(await newReturn('BUSINESS')).toMatchObject({
      businessName: 'Fake Bakery Holdings LLC',
      businessCity: 'Newtown',
    });
    await editProfile({ businessName: profile.businessName, city: profile.city });
  });

  it('takes the EIN only as a sealed number with its last 4', async () => {
    await editProfile({ einEnc: null, einLast4: null, einStatus: 'TO_BE_APPLIED_FOR' });
    expect(await newReturn('BUSINESS')).toMatchObject({
      businessEinEnc: null,
      businessEinLast4: null,
      businessName: profile.businessName,
    });
    await editProfile({ einEnc: profile.einEnc, einLast4: profile.einLast4, einStatus: null });
  });

  it('is correctable until first filed, then frozen', async () => {
    const r = await newReturn('BUSINESS');
    await expect(save(r.id, { businessAddressLine2: null })).resolves.toMatchObject({
      businessAddressLine2: null,
    });
    await save(r.id, { status: 'FILED', filedOn: new Date(Date.now() - 86_400_000) });
    expect(await failure(save(r.id, { businessName: 'Other Name LLC' }))).toMatch(
      /keeps its business identity/,
    );
    expect(
      await failure(save(r.id, { businessEinEnc: sealed(3), businessEinLast4: '1111' })),
    ).toMatch(/keeps its business identity/);
  });

  it('keeps the EIN rules: sealed, with its last 4, set together', async () => {
    const r = await newReturn('BUSINESS');
    expect(await failure(save(r.id, { businessEinLast4: null }))).toMatch(/check constraint/i);
    expect(await failure(save(r.id, { businessEinEnc: Buffer.from('123456789') }))).toMatch(
      /check constraint/i,
    );
    expect(await failure(save(r.id, { businessEinLast4: '12a4' }))).toMatch(/check constraint/i);
  });
});

describe('an individual return', () => {
  it('has no business identity', async () => {
    const r = await newReturn('INDIVIDUAL');
    expect(r).toMatchObject({ businessName: null, businessEinEnc: null, businessCity: null });
    expect(await failure(save(r.id, { businessName: 'Fake Bakery LLC' }))).toMatch(
      /check constraint/i,
    );
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's business identity", async () => {
    const r = await newReturn('BUSINESS');
    expect(await B().taxReturn.findMany({ where: { id: r.id } })).toEqual([]);
    const { count } = await B().taxReturn.updateMany({
      where: { id: r.id },
      data: { businessName: 'Firm B Was Here' },
    });
    expect(count).toBe(0);
  });

  it("a return made in firm B for firm A's client takes nothing from firm A", async () => {
    expect(
      await failure(
        B().taxReturn.create({
          data: { businessId: f.firmB, clientId: f.clientA, taxYear: 2025, filingType: 'BUSINESS' },
        }),
      ),
    ).not.toBe('');
  });
});
