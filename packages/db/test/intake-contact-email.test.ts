// R60's column request 12 (R1, Oct 24; migration r1_intake_contact_email): each firm's existing
// intake settings get the firm's own contact email first in "Notify additional emails", once,
// only where the list does not hold it yet. Replays the migration's SQL as the owner role, as
// `prisma migrate deploy` runs it (RLS forced, each firm in its own scope), on synthetic firms.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
const migration = readFileSync(
  new URL(
    '../prisma/migrations/20261024202721_r1_intake_contact_email/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const replay = () => owner.$executeRawUnsafe(migration);

const firms: Record<'added' | 'present' | 'full' | 'invalid' | 'noSettings' | 'none', string> = {
  added: '',
  present: '',
  full: '',
  invalid: '',
  noSettings: '',
  none: '',
};
const ten = Array.from({ length: 10 }, (_, i) => `staff${i}@full.example`);

async function contact(businessId: string, contactEmail: string) {
  await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.businessSettings.upsert({
      where: { businessId },
      create: { businessId, contactEmail },
      update: { contactEmail },
    }),
  );
}
const settings = (businessId: string, notifyAdditionalEmails: string[]) =>
  db
    .forBusiness(businessId)
    .intakeSettings.create({ data: { businessId, notifyAdditionalEmails } });
const list = async (businessId: string) =>
  (await db.forBusiness(businessId).intakeSettings.findUnique({ where: { businessId } }))
    ?.notifyAdditionalEmails;

beforeAll(async () => {
  const [one, two, three] = [
    await createTwoFirms(owner, 'r1ice1'),
    await createTwoFirms(owner, 'r1ice2'),
    await createTwoFirms(owner, 'r1ice3'),
  ];
  Object.assign(firms, {
    added: one.firmA,
    present: one.firmB,
    full: two.firmA,
    invalid: two.firmB,
    noSettings: three.firmA,
    none: three.firmB,
  });
  await contact(firms.added, 'owner@added.example');
  await settings(firms.added, ['partner@added.example']);
  await contact(firms.present, 'owner@present.example');
  await settings(firms.present, ['partner@present.example', 'Owner@Present.example']);
  await contact(firms.full, 'owner@full.example');
  await settings(firms.full, ten);
  await contact(firms.invalid, 'owner@invalid');
  await settings(firms.invalid, []);
  await contact(firms.noSettings, 'owner@nosettings.example');
  await settings(firms.none, ['partner@none.example']);
});

describe('r1_intake_contact_email', () => {
  it("puts the firm's own contact email first, once, and changes nothing else", async () => {
    const before = await db
      .forBusiness(firms.added)
      .intakeSettings.findUnique({ where: { businessId: firms.added } });
    await replay();
    const after = await db
      .forBusiness(firms.added)
      .intakeSettings.findUnique({ where: { businessId: firms.added } });
    expect(after).toEqual({
      ...before,
      notifyAdditionalEmails: ['owner@added.example', 'partner@added.example'],
    });

    await replay();
    expect(await list(firms.added)).toEqual(['owner@added.example', 'partner@added.example']);
  });

  it('leaves a list that holds it (ignoring case), a full list and an invalid address alone', async () => {
    await replay();
    expect(await list(firms.present)).toEqual(['partner@present.example', 'Owner@Present.example']);
    expect(await list(firms.full)).toEqual(ten);
    expect(await list(firms.invalid)).toEqual([]);
  });

  it('creates no intake settings, and adds only the firm its own address', async () => {
    await replay();
    expect(await list(firms.noSettings)).toBeUndefined();
    // A firm without a contact email gets nobody's address.
    expect(await list(firms.none)).toEqual(['partner@none.example']);
  });
});
