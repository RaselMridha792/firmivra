// r0_firm_theme_colors: the firm's sidebar, text and button colours on business_settings. Optional
// `#rrggbb` (null means derive from the brand colour); a firm reads and writes only its own row.
// Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '' };
const firm = (businessId: string) => db.forBusiness(businessId);

const THEME = {
  sidebarColor: '#001F4B',
  textPrimaryColor: '#001f4b',
  textSecondaryColor: '#485677',
  buttonColor: '#006FF0',
} as const;
const COLUMNS = Object.keys(THEME) as (keyof typeof THEME)[];

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ta-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `tb-${run}`, name: 'B' } })).id;
  });
  for (const businessId of [ids.firmA, ids.firmB]) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.businessSettings.create({ data: { businessId, brandColor: '#1f4e79' } }),
    );
  }
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('firm theme colours', () => {
  it('are empty on a new firm, so the screens derive them from the brand colour', async () => {
    const row = await firm(ids.firmA).businessSettings.findUniqueOrThrow({
      where: { businessId: ids.firmA },
    });
    expect(row).toMatchObject({
      brandColor: '#1f4e79',
      sidebarColor: null,
      textPrimaryColor: null,
      textSecondaryColor: null,
      buttonColor: null,
    });
  });

  it('a firm sets all four and clears them back to null', async () => {
    const save = (data: object) =>
      firm(ids.firmA).businessSettings.update({ where: { businessId: ids.firmA }, data });
    await expect(save(THEME)).resolves.toMatchObject(THEME);
    const cleared = Object.fromEntries(COLUMNS.map((c) => [c, null]));
    await expect(save(cleared)).resolves.toMatchObject(cleared);
  });

  it('rejects a colour that is not #rrggbb', async () => {
    for (const column of COLUMNS) {
      for (const value of ['navy', '#12345', '#1234567', '001F4B', '#GG0000', '']) {
        await expect(
          firm(ids.firmA).businessSettings.update({
            where: { businessId: ids.firmA },
            data: { [column]: value },
          }),
          `${column} = ${JSON.stringify(value)}`,
        ).rejects.toThrow(/check constraint/i);
      }
    }
  });

  it("a firm neither reads nor changes another firm's colours", async () => {
    await firm(ids.firmB).businessSettings.update({
      where: { businessId: ids.firmB },
      data: { buttonColor: '#E68B18' },
    });
    await expect(
      firm(ids.firmA).businessSettings.findUnique({ where: { businessId: ids.firmB } }),
    ).resolves.toBeNull();
    const changed = await firm(ids.firmA).businessSettings.updateMany({
      where: { businessId: ids.firmB },
      data: { buttonColor: '#000000' },
    });
    expect(changed.count).toBe(0);
    await expect(
      firm(ids.firmB).businessSettings.findUniqueOrThrow({ where: { businessId: ids.firmB } }),
    ).resolves.toMatchObject({ buttonColor: '#E68B18' });
  });
});
