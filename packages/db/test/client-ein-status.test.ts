// R56's B15 (R1, Oct 25; migration r1_client_ein_status): a business client's EIN status apart
// from the sealed number. A number is stored only with HAS_EIN, or with no status yet (rows from
// before this column), so a status is never saved as an EIN. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
// A well-formed sealed envelope (sealed_value_ok), as in admin-apply-profile-change.test.ts; no real EIN.
const sealed = Buffer.concat([Buffer.from([1, 1, 0, 8]), Buffer.alloc(8, 7), Buffer.alloc(32, 9)]);
const where = () => ({ clientId: f.clientA });
const save = (data: Record<string, unknown>) => A().clientProfile.update({ where: where(), data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1ein');
  await A().clientProfile.create({ data: { businessId: f.firmA, clientId: f.clientA } });
});

describe('EIN status', () => {
  it('starts empty, and takes a status without a number', async () => {
    await expect(A().clientProfile.findUnique({ where: where() })).resolves.toMatchObject({
      einStatus: null,
    });
    for (const einStatus of ['NOT_APPLICABLE', 'TO_BE_APPLIED_FOR', 'HAS_EIN']) {
      await expect(save({ einStatus, einEnc: null, einLast4: null })).resolves.toMatchObject({
        einStatus,
      });
    }
  });

  it('keeps a number only with HAS_EIN, or with no status yet', async () => {
    for (const einStatus of ['NOT_APPLICABLE', 'TO_BE_APPLIED_FOR']) {
      expect(await failure(save({ einStatus, einEnc: sealed, einLast4: '6789' }))).toMatch(
        /check constraint/i,
      );
    }
    await expect(
      save({ einStatus: 'HAS_EIN', einEnc: sealed, einLast4: '6789' }),
    ).resolves.toMatchObject({ einStatus: 'HAS_EIN', einLast4: '6789' });
    // A row from before the column: a number and no status.
    await expect(save({ einStatus: null })).resolves.toMatchObject({ einStatus: null });
    expect(await failure(save({ einStatus: 'NOT_APPLICABLE' }))).toMatch(/check constraint/i);
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's EIN status", async () => {
    expect(await B().clientProfile.findMany({ where: where() })).toEqual([]);
    const { count } = await B().clientProfile.updateMany({
      where: where(),
      data: { einStatus: 'NOT_APPLICABLE' },
    });
    expect(count).toBe(0);
  });
});
