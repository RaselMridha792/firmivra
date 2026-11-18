// R60, Staff Management Review 2 (Rasel's approval, Nov 18): SM20 a member's first and last name
// kept apart on staff_profiles, and SM21 invites.emailed_at. A firm never sees another firm's rows,
// the names follow users.name's rules, and the migration's backfill splits a name on its last
// space without changing users.name. Runs as the app role under RLS; the backfill as the owner.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r60nm');
});

const membershipOf = (userId: string) => A().membership.findFirstOrThrow({ where: { userId } });

describe('first and last name (SM20)', () => {
  it('keeps a compound first name apart from the last name, in the firm only', async () => {
    const m = await membershipOf(f.member2A);
    const profile = await A().staffProfile.create({
      data: {
        businessId: f.firmA,
        membershipId: m.id,
        firstName: 'Fake Mary Ann',
        lastName: 'Smith',
      },
    });
    expect([profile.firstName, profile.lastName]).toEqual(['Fake Mary Ann', 'Smith']);
    expect(await B().staffProfile.findMany({ where: { membershipId: m.id } })).toEqual([]);
    // A blank, a control character or more than 120 characters are refused; null is allowed.
    for (const firstName of ['  ', 'Fake\u0007', 'x'.repeat(121)]) {
      expect(
        await failure(
          A().staffProfile.update({
            where: { businessId_membershipId: { businessId: f.firmA, membershipId: m.id } },
            data: { firstName },
          }),
        ),
      ).toMatch(/staff_profiles_names/);
    }
    const cleared = await A().staffProfile.update({
      where: { businessId_membershipId: { businessId: f.firmA, membershipId: m.id } },
      data: { lastName: null },
    });
    expect(cleared.lastName).toBeNull();
  });

  it("the migration's backfill splits users.name on the last space and never changes it", async () => {
    const m = await membershipOf(f.memberA);
    await A().staffProfile.upsert({
      where: { businessId_membershipId: { businessId: f.firmA, membershipId: m.id } },
      create: { businessId: f.firmA, membershipId: m.id },
      update: { firstName: null, lastName: null },
    });
    const user = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.user.update({ where: { id: f.memberA }, data: { name: 'Fake SAL QA Import' } }),
    );
    const sql = readFileSync(
      new URL(
        '../prisma/migrations/20261118213000_r60_staff_names_invite_emailed/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const backfill = sql.slice(sql.indexOf('UPDATE staff_profiles sp'));
    await owner.$executeRawUnsafe(backfill);
    const after = await A().staffProfile.findUniqueOrThrow({
      where: { businessId_membershipId: { businessId: f.firmA, membershipId: m.id } },
    });
    expect([after.firstName, after.lastName]).toEqual(['Fake SAL QA', 'Import']);
    const same = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: f.memberA } }),
    );
    expect(same.name).toBe(user.name);
  });
});

describe('the invitation email time (SM21)', () => {
  it('is null until set, set on the firm’s own invite only', async () => {
    const m = await membershipOf(f.member2A);
    const invite = await A().invite.create({
      data: {
        businessId: f.firmA,
        membershipId: m.id,
        name: 'Fake Invitee',
        email: `invitee-${f.firmA}@x.test`,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    expect(invite.emailedAt).toBeNull();
    const at = new Date();
    const sent = await A().invite.update({ where: { id: invite.id }, data: { emailedAt: at } });
    expect(sent.emailedAt).toEqual(at);
    expect(
      await failure(
        B().invite.update({ where: { id: invite.id }, data: { emailedAt: new Date() } }),
      ),
    ).not.toBe('');
  });
});
