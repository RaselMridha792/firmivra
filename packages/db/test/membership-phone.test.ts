// memberships.phone and phone_verified_at (R1, Nov 14; Dashboard Review 2 R2 NEW2; migration
// r1_membership_phone): a firm's own number for a member, E.164 only, verified only with a number,
// and no longer verified once it changes. Firm A's row is firm A's: firm B neither reads nor
// changes it. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const mine = () => ({ businessId_userId: { businessId: f.firmA, userId: f.memberA } });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1mph');
});

describe('memberships.phone', () => {
  it('takes an E.164 number or none, and refuses anything else', async () => {
    await expect(
      A().membership.update({ where: mine(), data: { phone: '+15555550123' } }),
    ).resolves.toMatchObject({ phone: '+15555550123', phoneVerifiedAt: null });
    for (const phone of [
      '5555550123',
      '+0555550123',
      '+1 555 555 0123',
      '+1234',
      `+1${'2'.repeat(15)}`,
    ]) {
      expect(
        await failure(A().membership.update({ where: mine(), data: { phone } })),
        phone,
      ).toMatch(/memberships_phone_format/);
    }
    await expect(
      A().membership.update({ where: mine(), data: { phone: null } }),
    ).resolves.toMatchObject({ phone: null });
  });

  it('is verified only with a number, and a new number is not verified', async () => {
    expect(
      await failure(
        A().membership.update({
          where: mine(),
          data: { phone: null, phoneVerifiedAt: new Date() },
        }),
      ),
    ).toMatch(/memberships_phone_verified/);
    const at = new Date();
    await expect(
      A().membership.update({
        where: mine(),
        data: { phone: '+15555550124', phoneVerifiedAt: at },
      }),
    ).resolves.toMatchObject({ phoneVerifiedAt: at });
    // Another column changing keeps it; the number changing clears it.
    await expect(
      A().membership.update({ where: mine(), data: { jobTitle: 'Preparer (fake)' } }),
    ).resolves.toMatchObject({ phoneVerifiedAt: at });
    await expect(
      A().membership.update({ where: mine(), data: { phone: '+15555550125' } }),
    ).resolves.toMatchObject({ phone: '+15555550125', phoneVerifiedAt: null });
  });

  it("is firm A's own: firm B neither reads nor changes it", async () => {
    await A().membership.update({ where: mine(), data: { phone: '+15555550126' } });
    const B = db.forBusiness(f.firmB);
    expect(await B.membership.findMany({ where: { phone: '+15555550126' } })).toEqual([]);
    const changed = await B.membership.updateMany({
      where: { businessId: f.firmA, userId: f.memberA },
      data: { phone: '+15555550127' },
    });
    expect(changed.count).toBe(0);
    await expect(
      A().membership.findUniqueOrThrow({ where: mine(), select: { phone: true } }),
    ).resolves.toEqual({ phone: '+15555550126' });
  });
});
