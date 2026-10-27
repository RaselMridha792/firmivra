// Clients E5 (R1, Oct 26; migration r1_client_responsible_party, R60's column request 14): a
// Business client's responsible party on its profile: full name, lower-case email and E.164
// phone, set together or not at all. Runs as the app role under RLS. Synthetic people only.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const party = {
  responsiblePartyName: 'Pat Example',
  responsiblePartyEmail: 'pat@example.test',
  responsiblePartyPhone: '+14045550123',
};
const save = (data: Record<string, unknown>) =>
  A().clientProfile.update({ where: { clientId: f.clientA }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1rp');
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.clientProfile.create({
      data: { businessId: f.firmA, clientId: f.clientA, businessName: 'Fake Bakery LLC' },
    }),
  );
});

describe('responsible party', () => {
  it('is empty at first, and the three are kept together', async () => {
    await expect(
      A().clientProfile.findUniqueOrThrow({ where: { clientId: f.clientA } }),
    ).resolves.toMatchObject({ responsiblePartyName: null, responsiblePartyPhone: null });
    await expect(save(party)).resolves.toMatchObject(party);
    await expect(save({ ...party, responsiblePartyName: 'Sam Example' })).resolves.toMatchObject({
      responsiblePartyName: 'Sam Example',
    });
    await expect(
      save({
        responsiblePartyName: null,
        responsiblePartyEmail: null,
        responsiblePartyPhone: null,
      }),
    ).resolves.toMatchObject({ responsiblePartyEmail: null });
  });

  it('refuses one without the others, and badly formed values', async () => {
    expect(await failure(save({ responsiblePartyName: 'Pat Example' }))).toMatch(
      /check constraint/i,
    );
    for (const bad of [
      { responsiblePartyName: ' Pat ' },
      { responsiblePartyName: 'x'.repeat(201) },
      { responsiblePartyEmail: 'Pat@Example.test' },
      { responsiblePartyEmail: 'pat@example' },
      { responsiblePartyPhone: '404-555-0123' },
      { responsiblePartyPhone: '+0404555' },
    ]) {
      expect(await failure(save({ ...party, ...bad }))).toMatch(/check constraint/i);
    }
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's responsible party", async () => {
    await save(party);
    expect(await B().clientProfile.findMany({ where: { clientId: f.clientA } })).toEqual([]);
    const { count } = await B().clientProfile.updateMany({
      where: { clientId: f.clientA },
      data: { responsiblePartyName: 'Firm B Was Here' },
    });
    expect(count).toBe(0);
    await expect(
      A().clientProfile.findUniqueOrThrow({ where: { clientId: f.clientA } }),
    ).resolves.toMatchObject(party);
  });
});
