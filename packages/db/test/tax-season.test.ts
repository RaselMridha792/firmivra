// The firm's tax season (R1, Nov 14; migration r1_tax_season, Dashboard Review 2 "Tax season
// context"): `MM-DD` to `MM-DD`, a real day of a month and never Feb 29, two different days, both
// set or both null; the firm's own row only. And QA seed part 5: Test Firm B's season, set once,
// never over a season already set, never another firm. Runs as the app role under RLS; the seed
// runs as the owner role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { QA_SEASON, seedQaSeason } from '../prisma/seed-qa-season.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const set = (data: { taxSeasonStart: string | null; taxSeasonEnd: string | null }) =>
  db.forBusiness(f.firmA).businessSettings.upsert({
    where: { businessId: f.firmA },
    create: { businessId: f.firmA, ...data },
    update: data,
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'season');
});

describe('business_settings tax season', () => {
  it('takes a season, one across Jan 1, and none', async () => {
    await expect(set({ taxSeasonStart: '01-15', taxSeasonEnd: '04-15' })).resolves.toMatchObject({
      taxSeasonStart: '01-15',
      taxSeasonEnd: '04-15',
    });
    await expect(set({ taxSeasonStart: '12-01', taxSeasonEnd: '04-30' })).resolves.toMatchObject({
      taxSeasonStart: '12-01',
    });
    await expect(set({ taxSeasonStart: null, taxSeasonEnd: null })).resolves.toMatchObject({
      taxSeasonStart: null,
      taxSeasonEnd: null,
    });
  });

  it('refuses a day that is not real, Feb 29, the same day twice and half a season', async () => {
    for (const [start, end] of [
      ['02-30', '04-15'],
      ['02-29', '04-15'],
      ['04-31', '05-15'],
      ['13-01', '04-15'],
      ['1-15', '04-15'],
      ['01-15', '01-15'],
      ['01-15', null],
      [null, '04-15'],
    ] as const)
      expect(
        await failure(set({ taxSeasonStart: start, taxSeasonEnd: end })),
        `${start} to ${end}`,
      ).toMatch(/business_settings_tax_season/);
  });

  it("is the firm's own: another firm neither reads nor changes it", async () => {
    await set({ taxSeasonStart: '01-15', taxSeasonEnd: '04-15' });
    await expect(
      db.forBusiness(f.firmB).businessSettings.findUnique({ where: { businessId: f.firmA } }),
    ).resolves.toBeNull();
    const changed = await db.forBusiness(f.firmB).businessSettings.updateMany({
      where: { businessId: f.firmA },
      data: { taxSeasonStart: '02-01', taxSeasonEnd: '03-01' },
    });
    expect(changed.count).toBe(0);
  });
});

describe('QA seed part 5', () => {
  // The seed-qa tests make the same firms at the same time: on a clash, the other file's firm.
  const firm = async (slug: string): Promise<string> => {
    const find = () =>
      runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.business.findUnique({ where: { slug }, select: { id: true } }),
      );
    const found = await find();
    if (found) return found.id;
    try {
      return await runInScope(
        owner,
        { kind: 'platform' },
        async (tx) =>
          (
            await tx.business.create({
              data: { slug, name: `${slug} (test)`, status: 'ACTIVE' },
              select: { id: true },
            })
          ).id,
      );
    } catch {
      const made = await find();
      if (!made) throw new Error(`firm ${slug} was neither made nor found`);
      return made.id;
    }
  };
  const seasonOf = (businessId: string) =>
    runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.businessSettings.findUnique({
        where: { businessId },
        select: { taxSeasonStart: true, taxSeasonEnd: true },
      }),
    );

  it("sets Test Firm B's season once, keeps one already set, and leaves LVP alone", async () => {
    const firmB = await firm('test-firm-b');
    const lvp = await firm('lvp');
    const lvpBefore = await seasonOf(lvp);
    await runInScope(owner, { kind: 'business', businessId: firmB }, (tx) =>
      tx.businessSettings.updateMany({
        where: { businessId: firmB },
        data: { taxSeasonStart: null, taxSeasonEnd: null },
      }),
    );
    expect(await seedQaSeason(owner)).toBe('seeded');
    expect(await seasonOf(firmB)).toEqual(QA_SEASON);
    expect(await seedQaSeason(owner)).toBe('already');
    // A season set in Settings is kept.
    await runInScope(owner, { kind: 'business', businessId: firmB }, (tx) =>
      tx.businessSettings.update({
        where: { businessId: firmB },
        data: { taxSeasonStart: '02-01', taxSeasonEnd: '05-15' },
      }),
    );
    expect(await seedQaSeason(owner)).toBe('already');
    expect(await seasonOf(firmB)).toEqual({ taxSeasonStart: '02-01', taxSeasonEnd: '05-15' });
    expect(await seasonOf(lvp)).toEqual(lvpBefore);
  });
});
