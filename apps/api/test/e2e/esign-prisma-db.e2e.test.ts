// The shared Prisma helpers of Firm Sign (esign-prisma.ts) against PostgreSQL: the request lock
// and lastActivityAt check, recipients removed, kept and added in order, and field values sealed
// with the firm key and read back. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignFieldValues } from '../../src/esign/requests/esign-prisma.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
} from '../../src/esign/requests/esign.repository.js';
import { type EsignDbWorld, esignDbWorld, readyDraft } from './esign-db.js';

let w: EsignDbWorld;
let repo: EsignRepository;
const base = '/api/v1/esign/requests';

beforeAll(async () => {
  w = await esignDbWorld('r13-helpers-db');
  repo = w.app.get<EsignRepository>(ESIGN_REPOSITORY);
});
afterAll(async () => {
  await w?.close();
});

describe('Firm Sign Prisma helpers on PostgreSQL', () => {
  it('a write with a stale readAt changes nothing; a fresh one moves lastActivityAt on', async () => {
    const d = await readyDraft(w, w.a, 'Fake letter, stale write');
    const before = (await repo.findRequest(w.a.id, d.id))!;
    const { fields } = await repo.parts(w.a.id, d.id);
    const stale = new Date(before.lastActivityAt.getTime() - 1);
    expect(await repo.saveFields(w.a.id, d.id, [], stale)).toBeNull();
    expect((await repo.parts(w.a.id, d.id)).fields).toHaveLength(fields.length);
    expect((await repo.findRequest(w.a.id, d.id))!.lastActivityAt).toEqual(before.lastActivityAt);

    const written = await repo.saveFields(w.a.id, d.id, fields.slice(0, 1), before.lastActivityAt);
    expect(written).not.toBeNull();
    expect(written!.lastActivityAt.getTime()).toBeGreaterThan(before.lastActivityAt.getTime());
    expect((await repo.parts(w.a.id, d.id)).fields).toHaveLength(1);
    // The old readAt is stale now.
    expect(await repo.saveFields(w.a.id, d.id, [], before.lastActivityAt)).toBeNull();
  });

  it('recipients: a left-out one is removed, a kept one keeps its id, new ones are added in order', async () => {
    const d = await readyDraft(w, w.a, 'Fake letter, recipients');
    const owner = w.a.people.owner;
    const external = (name: string) => ({
      role: 'WITNESS',
      routingOrder: 1,
      who: { type: 'EXTERNAL', name, email: `${name.toLowerCase().replace(/ /g, '-')}@esign.test` },
      authMethod: 'EMAIL_CODE',
    });
    const first = await w.call('put', `${base}/${d.id}/recipients`, owner, {
      recipients: [
        {
          id: d.signer,
          role: 'CLIENT',
          routingOrder: 1,
          who: { type: 'CLIENT_LOGIN', clientAccountId: w.a.ids.login },
          authMethod: 'LINK',
        },
        external('Fake Witness One'),
      ],
    });
    expect(first.status).toBe(200);
    const one = (first.body as { recipients: { id: string; name: string }[] }).recipients[1]!;
    const second = await w.call('put', `${base}/${d.id}/recipients`, owner, {
      recipients: [
        external('Fake Witness Two'),
        {
          id: d.signer,
          role: 'CLIENT',
          routingOrder: 2,
          who: { type: 'CLIENT_LOGIN', clientAccountId: w.a.ids.login },
          authMethod: 'LINK',
        },
      ],
    });
    expect(second.status).toBe(200);
    const rows = await w.inFirm(w.a.id, (tx) =>
      tx.esignRecipient.findMany({ where: { requestId: d.id }, orderBy: { position: 'asc' } }),
    );
    expect(rows.map((r) => [r.position, r.name, r.routingOrder])).toEqual([
      [0, 'Fake Witness Two', 1],
      [1, rows[1]!.name, 2],
    ]);
    expect(rows[1]!.id).toBe(d.signer);
    expect(rows.map((r) => r.id)).not.toContain(one.id);
  });

  it('field values are sealed with the firm key and open back to the value', async () => {
    const d = await readyDraft(w, w.a, 'Fake letter, sealed values');
    const [row] = await w.inFirm(w.a.id, (tx) =>
      tx.esignField.findMany({ where: { requestId: d.id, recipientId: null } }),
    );
    expect(Buffer.from(row!.valueEnc!).toString('latin1')).not.toContain('Fake sender note');
    const values = w.app.get(EsignFieldValues);
    expect(await values.open(w.a.id, row!.id, row!.valueEnc!)).toBe('Fake sender note');
    // Bound to its firm and its field: another firm or field cannot open it.
    await expect(values.open(w.b.id, row!.id, row!.valueEnc!)).rejects.toThrow();
    await expect(values.open(w.a.id, d.signer, row!.valueEnc!)).rejects.toThrow();
    // Many at once (sealed with bounded concurrency), each under its own field id.
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: crypto.randomUUID(),
      value: `v${i}`,
    }));
    const sealed = await values.seal(w.a.id, many);
    for (const f of many) expect(await values.open(w.a.id, f.id, sealed.get(f.id)!)).toBe(f.value);
  });
});
