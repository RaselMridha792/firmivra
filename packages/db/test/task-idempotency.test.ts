// Idempotency keys on tasks and task series (R1, Oct 24; migrations r1_task_idempotency_keys and
// r1_task_series_idempotency_keys, one per table): the key a screen sends with a save that makes a
// task or a series, kept with where it was used. A key is unique per firm (another firm may use the
// same one, and rows without a key never clash), a key comes with its scope and a scope with its
// key, each table takes only its own routes' scopes, and a firm never sees, finds or changes
// another firm's keyed rows. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { databaseErrorCode } from '../src/errors.js';
import { connect, createTwoFirms, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
type Firm = 'A' | 'B';
const firm = (x: Firm) =>
  x === 'A'
    ? { db: A(), businessId: f.firmA, clientId: f.clientA, userId: f.memberA }
    : { db: B(), businessId: f.firmB, clientId: f.clientB, userId: f.memberB };
const select = { id: true, idempotencyKey: true, idempotencyScope: true } as const;

/** A task of the firm's client by its member, with these columns. */
const task = (data: Record<string, unknown> = {}, x: Firm = 'A') => {
  const { db: client, businessId, clientId, userId } = firm(x);
  return client.task.create({
    data: { businessId, clientId, createdByUserId: userId, title: 'Keyed task (fake)', ...data },
    select,
  });
};
/** A monthly series of the firm's client by its member, with these columns. */
const series = (data: Record<string, unknown> = {}, x: Firm = 'A') => {
  const { db: client, businessId, clientId, userId } = firm(x);
  return client.taskSeries.create({
    data: {
      businessId,
      clientId,
      createdByUserId: userId,
      title: 'Keyed series (fake)',
      unit: 'MONTH',
      startOn: new Date('2026-11-01'),
      ...data,
    },
    select,
  });
};
const keyed = (scope: string, key = randomUUID()) => ({
  idempotencyKey: key,
  idempotencyScope: scope,
});

/**
 * How the database answered: '' when the write went through, otherwise "<SQLSTATE> <message and
 * meta>", so a test can name both the code and the constraint or index.
 */
async function refusal(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (error) {
    const code = databaseErrorCode(error) ?? String((error as { code?: unknown }).code);
    const meta = JSON.stringify((error as { meta?: unknown }).meta ?? {});
    return `${code} ${error instanceof Error ? error.message : String(error)} ${meta}`;
  }
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tik');
});

describe('one key per firm', () => {
  it('refuses a key a firm already used, in each table, whatever the scope (23505)', async () => {
    const key = randomUUID();
    const first = await task(keyed('create', key));
    expect(first).toMatchObject({ idempotencyKey: key, idempotencyScope: 'create' });
    for (const data of [
      keyed('create', key),
      { ...keyed('draft', key), status: 'DRAFT' },
      keyed(`duplicate:${first.id}`, key),
    ]) {
      expect(await refusal(task(data)), JSON.stringify(data)).toMatch(
        /^23505 .*tasks_business_id_idempotency_key_key/s,
      );
    }

    const seriesKey = randomUUID();
    await series(keyed('series', seriesKey));
    for (const data of [keyed('series', seriesKey), keyed(`convert:${first.id}`, seriesKey)]) {
      expect(await refusal(series(data)), JSON.stringify(data)).toMatch(
        /^23505 .*task_series_business_id_idempotency_key_key/s,
      );
    }
    expect(await A().task.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await A().taskSeries.count({ where: { idempotencyKey: seriesKey } })).toBe(1);
  });

  it('lets another firm use the same key, and keeps each firm its own row', async () => {
    const key = randomUUID();
    const a = await task(keyed('create', key));
    const b = await task(keyed('create', key), 'B');
    expect(b.id).not.toBe(a.id);
    const sa = await series(keyed('series', key));
    const sb = await series(keyed('series', key), 'B');
    expect(sb.id).not.toBe(sa.id);
    expect((await A().task.findMany({ where: { idempotencyKey: key } })).map((t) => t.id)).toEqual([
      a.id,
    ]);
    expect((await B().task.findMany({ where: { idempotencyKey: key } })).map((t) => t.id)).toEqual([
      b.id,
    ]);
  });

  it('lets rows without a key repeat (every row before the migration has none)', async () => {
    const made = [await task(), await task(), await task({ status: 'DRAFT' })];
    const plans = [await series(), await series()];
    for (const row of [...made, ...plans]) {
      expect(row).toMatchObject({ idempotencyKey: null, idempotencyScope: null });
    }
    expect(
      await A().task.count({ where: { id: { in: made.map((t) => t.id) }, idempotencyKey: null } }),
    ).toBe(3);
  });

  it('keeps the two tables apart: one key may be on a task and on a series', async () => {
    // The API answers 409 for a key used on another route, also at once (it locks the key first);
    // the database only keeps each once per table.
    const key = randomUUID();
    await task(keyed('create', key));
    await expect(series(keyed('series', key))).resolves.toMatchObject({ idempotencyKey: key });
  });
});

describe('a key comes with its scope', () => {
  it('refuses a key without its scope, or a scope without its key (23514)', async () => {
    for (const data of [{ idempotencyKey: randomUUID() }, { idempotencyScope: 'create' }]) {
      expect(await refusal(task(data)), JSON.stringify(data)).toMatch(
        /^23514 .*tasks_idempotency_pair/s,
      );
    }
    for (const data of [{ idempotencyKey: randomUUID() }, { idempotencyScope: 'series' }]) {
      expect(await refusal(series(data)), JSON.stringify(data)).toMatch(
        /^23514 .*task_series_idempotency_pair/s,
      );
    }
  });

  it("takes only its own routes' scopes, with the task id in lower case (23514)", async () => {
    const source = (await task()).id;
    for (const scope of ['create', 'draft', `duplicate:${source}`]) {
      await expect(task(keyed(scope))).resolves.toMatchObject({ idempotencyScope: scope });
    }
    for (const scope of ['series', `convert:${source}`]) {
      await expect(series(keyed(scope))).resolves.toMatchObject({ idempotencyScope: scope });
    }

    for (const scope of [
      // The series' routes, and routes that take no key
      'series',
      `convert:${source}`,
      'publish',
      'update',
      // Not written as the API writes them
      'Create',
      ' create',
      'create ',
      '',
      'duplicate',
      'duplicate:',
      `duplicate:${source.toUpperCase()}`,
      `duplicate:${source}x`,
      'duplicate:not-a-task',
      `duplicate:${source.replaceAll('-', '')}`,
    ]) {
      expect(await refusal(task(keyed(scope))), scope).toMatch(/^23514 .*tasks_idempotency_scope/s);
    }
    for (const scope of [
      'create',
      'draft',
      `duplicate:${source}`,
      'SERIES',
      'convert',
      'convert:',
      `convert:${source.toUpperCase()}`,
      `series:${source}`,
    ]) {
      expect(await refusal(series(keyed(scope))), scope).toMatch(
        /^23514 .*task_series_idempotency_scope/s,
      );
    }
  });

  it('keeps the key and its scope when a draft is published', async () => {
    const draft = await task({ ...keyed('draft'), status: 'DRAFT' });
    const live = await A().task.update({
      where: { id: draft.id },
      data: { status: 'OPEN' },
      select,
    });
    expect(live).toEqual(draft);
    // Clearing one of the two is refused; clearing both is fine.
    expect(
      await refusal(A().task.update({ where: { id: draft.id }, data: { idempotencyKey: null } })),
    ).toMatch(/^23514 .*tasks_idempotency_pair/s);
    await expect(
      A().task.update({
        where: { id: draft.id },
        data: { idempotencyKey: null, idempotencyScope: null },
        select,
      }),
    ).resolves.toMatchObject({ idempotencyKey: null, idempotencyScope: null });
  });
});

describe('isolation', () => {
  it("another firm never sees, finds by key or changes a firm's keyed rows", async () => {
    const key = randomUUID();
    const t = await task(keyed('create', key));
    const s = await series(keyed('series', key));
    expect(await B().task.findMany({ where: { idempotencyKey: key } })).toEqual([]);
    expect(await B().taskSeries.findMany({ where: { idempotencyKey: key } })).toEqual([]);
    expect(await B().task.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await B().taskSeries.findUnique({ where: { id: s.id } })).toBeNull();
    const cleared = { idempotencyKey: null, idempotencyScope: null };
    expect((await B().task.updateMany({ where: { id: t.id }, data: cleared })).count).toBe(0);
    expect((await B().taskSeries.updateMany({ where: { id: s.id }, data: cleared })).count).toBe(0);

    // Firm B cannot write a keyed row into firm A, nor give its own row firm A's client.
    expect(
      await refusal(
        B().task.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            title: 'Sneaky (fake)',
            ...keyed('create'),
          },
        }),
      ),
    ).toMatch(/row-level security/i);
    expect(
      await refusal(
        B().task.create({
          data: {
            businessId: f.firmB,
            clientId: f.clientA,
            title: 'Sneaky (fake)',
            ...keyed('create'),
          },
        }),
      ),
    ).toMatch(/foreign key/i);

    expect(await A().task.findMany({ where: { idempotencyKey: key }, select })).toEqual([t]);
    expect(await A().taskSeries.findMany({ where: { idempotencyKey: key }, select })).toEqual([s]);
  });
});
