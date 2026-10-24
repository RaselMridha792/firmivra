// Idempotency keys on the Tasks module's saves that create something (R1, Oct 24): task-common.ts's
// firstByKey and keyedSave. A key is locked for the firm and then looked up first; the same
// member's retry on the same route and task reads the first record and writes nothing; any other
// use of the key is 409, on a task or a series; an insert that still meets the key's unique index
// reads the winner's record in a new transaction; every other error goes on unchanged.
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { describe, expect, it } from 'vitest';
import type { ClientsActor } from '../../src/clients/clients.service.js';
import {
  firstByKey,
  keyColumns,
  keyedSave,
  keyScope,
  SERIES_KEY_INDEX,
  TASK_KEY_INDEX,
} from '../../src/tasks/task-common.js';

const FIRM = '0199c0e0-0a00-7000-8000-00000000f1a0';
const ME = '0199c0e0-0a00-7000-8000-0000000000a1';
const OTHER = '0199c0e0-0a00-7000-8000-0000000000b2';
const KEY = '0199c0e0-0a00-7000-8000-0000000000cc';
const SOURCE = '0199c0e0-0a00-7000-8000-0000000000d4';
const actor: ClientsActor = { userId: ME.toUpperCase(), role: 'OWNER' };

interface Row {
  id: string;
  createdByUserId: string | null;
  idempotencyScope: string | null;
  status?: string;
}

/**
 * A transaction whose tasks and series tables hold at most these keyed rows. `asked`: each lookup's
 * arguments; `steps`: each lookup's table and each advisory lock's name, in order.
 */
function fakeTx(rows: { task?: Row; series?: Row }) {
  const asked: unknown[] = [];
  const steps: string[] = [];
  const table = (name: string, row: Row | undefined) => ({
    findFirst: async (args: unknown) => {
      asked.push(args);
      steps.push(name);
      return row ?? null;
    },
  });
  const tx = {
    task: table('tasks', rows.task),
    taskSeries: table('task_series', rows.series),
    // Prisma's tagged template: the SQL around the values, then the values.
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))');
      steps.push(`lock ${String(values[0])}`);
      return 1;
    },
  } as unknown as TxClient;
  return { tx, asked, steps };
}

/** A database whose transactions run on `txs` in turn, counting how many were opened. */
function fakeDatabase(txs: TxClient[]) {
  const opened: string[] = [];
  const database = {
    withScope: async (
      scope: { kind: string; businessId: string },
      fn: (tx: TxClient) => unknown,
    ) => {
      opened.push(`${scope.kind}:${scope.businessId}`);
      const tx = txs.shift();
      if (!tx) throw new Error('no transaction left');
      return fn(tx);
    },
  } as unknown as Database;
  return { database, opened };
}

/** Prisma's error for a unique index, as the pg adapter reports it. */
const uniqueError = (index: string) =>
  Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { index } } } },
  });

const mine = (scope: string, status = 'OPEN'): Row => ({
  id: 'first',
  createdByUserId: ME,
  idempotencyScope: scope,
  status,
});

describe('keyScope and keyColumns', () => {
  it('names the route, and the task in the URL in lower case', () => {
    expect(keyScope.duplicate(SOURCE.toUpperCase())).toBe(`duplicate:${SOURCE}`);
    expect(keyScope.convert(SOURCE.toUpperCase())).toBe(`convert:${SOURCE}`);
    expect(keyColumns(KEY, 'create')).toEqual({ idempotencyKey: KEY, idempotencyScope: 'create' });
    expect(keyColumns(undefined, 'create')).toEqual({});
  });
});

describe('firstByKey', () => {
  it('is null for a new key, after looking in both tables of this firm', async () => {
    const { tx, asked } = fakeTx({});
    expect(await firstByKey(tx, FIRM, actor, KEY, keyScope.create)).toBeNull();
    expect(asked).toHaveLength(2);
    for (const args of asked) {
      expect(args).toMatchObject({ where: { businessId: FIRM, idempotencyKey: KEY } });
    }
  });

  it('gives the record back to the member who made it, on the same route and task', async () => {
    const cases: [Row | undefined, Row | undefined, string][] = [
      [mine('create'), undefined, keyScope.create],
      [mine(keyScope.duplicate(SOURCE)), undefined, keyScope.duplicate(SOURCE.toUpperCase())],
      [mine('draft', 'DRAFT'), undefined, keyScope.draft],
      [undefined, mine('series'), keyScope.series],
      [undefined, mine(keyScope.convert(SOURCE)), keyScope.convert(SOURCE)],
    ];
    for (const [task, series, scope] of cases) {
      const { tx } = fakeTx({ task, series });
      expect(await firstByKey(tx, FIRM, actor, KEY, scope), scope).toBe('first');
    }
  });

  it('is 409 IDEMPOTENCY_KEY_REUSED for any other use of the key, and shows nothing', async () => {
    const cases: [Row | undefined, Row | undefined, string][] = [
      // Another member
      [{ ...mine('create'), createdByUserId: OTHER }, undefined, keyScope.create],
      [{ ...mine('create'), createdByUserId: null }, undefined, keyScope.create],
      // Another route
      [mine('create'), undefined, keyScope.draft],
      [mine('draft', 'DRAFT'), undefined, keyScope.create],
      [mine('create'), undefined, keyScope.series],
      [undefined, mine('series'), keyScope.create],
      // Another task in the URL
      [mine(keyScope.duplicate(SOURCE)), undefined, keyScope.duplicate(OTHER)],
      [undefined, mine(keyScope.convert(SOURCE)), keyScope.convert(OTHER)],
      // A draft since published
      [mine('draft', 'OPEN'), undefined, keyScope.draft],
    ];
    for (const [task, series, scope] of cases) {
      const { tx } = fakeTx({ task, series });
      const refused = await firstByKey(tx, FIRM, actor, KEY, scope).catch((e: unknown) => e);
      expect(refused, JSON.stringify({ task, series, scope })).toBeInstanceOf(ConflictException);
      const body = (refused as ConflictException).getResponse() as Record<string, unknown>;
      expect(body).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED', message: expect.any(String) });
    }
  });

  it('finds the row of its own route when the key is on a task and on a series', async () => {
    const { tx } = fakeTx({
      task: { ...mine('create'), id: 'task' },
      series: { ...mine('series'), id: 'series' },
    });
    expect(await firstByKey(tx, FIRM, actor, KEY, keyScope.series)).toBe('series');
  });
});

describe('keyedSave', () => {
  const keyed = (key: string | undefined) => ({
    key,
    scope: keyScope.create,
    index: TASK_KEY_INDEX,
  });
  const never = (error: unknown): never => {
    throw error;
  };

  it('without a key, only creates: no lock, no lookup', async () => {
    const { tx, steps } = fakeTx({ task: mine('create') });
    const { database, opened } = fakeDatabase([tx]);
    const out = await keyedSave(
      database,
      FIRM,
      actor,
      keyed(undefined),
      async () => 'read',
      async () => 'made',
      never,
    );
    expect(out).toBe('made');
    expect(steps).toEqual([]);
    expect(opened).toEqual([`business:${FIRM}`]);
  });

  it('locks the firm’s key (in lower case, the same for every route) before looking it up and creating', async () => {
    for (const [scope, index] of [
      [keyScope.create, TASK_KEY_INDEX],
      [keyScope.convert(SOURCE), SERIES_KEY_INDEX],
    ] as const) {
      const { tx, steps } = fakeTx({});
      const { database } = fakeDatabase([tx]);
      const out = await keyedSave(
        database,
        FIRM,
        actor,
        { key: KEY.toUpperCase(), scope, index },
        async () => 'read',
        async () => {
          steps.push('create');
          return 'made';
        },
        never,
      );
      expect(out).toBe('made');
      expect(steps).toEqual([`lock task-key:${FIRM}:${KEY}`, 'tasks', 'task_series', 'create']);
    }
  });

  it('a new key creates; a retry of the same save reads the first record and writes nothing', async () => {
    const created: string[] = [];
    const create = async () => {
      created.push('made');
      return 'made';
    };
    const fresh = fakeDatabase([fakeTx({}).tx]);
    expect(
      await keyedSave(fresh.database, FIRM, actor, keyed(KEY), async () => 'read', create, never),
    ).toBe('made');
    const retry = fakeDatabase([fakeTx({ task: mine('create') }).tx]);
    const reads: string[] = [];
    const read = async (_tx: TxClient, id: string) => {
      reads.push(id);
      return `read ${id}`;
    };
    expect(await keyedSave(retry.database, FIRM, actor, keyed(KEY), read, create, never)).toBe(
      'read first',
    );
    expect(created).toEqual(['made']);
    expect(reads).toEqual(['first']);
  });

  it('an insert that still meets the key index reads the winner’s record in a new transaction', async () => {
    const { database, opened } = fakeDatabase([fakeTx({}).tx, fakeTx({ task: mine('create') }).tx]);
    const out = await keyedSave(
      database,
      FIRM,
      actor,
      keyed(KEY),
      async (_tx, id) => `read ${id}`,
      async () => {
        throw uniqueError(TASK_KEY_INDEX);
      },
      () => {
        throw new Error('mapped instead of replayed');
      },
    );
    expect(out).toBe('read first');
    expect(opened).toHaveLength(2);
  });

  it('two at once, the winner another member’s: 409', async () => {
    const theirs = { ...mine('create'), createdByUserId: OTHER };
    const { database } = fakeDatabase([fakeTx({}).tx, fakeTx({ task: theirs }).tx]);
    const out = keyedSave(
      database,
      FIRM,
      actor,
      keyed(KEY),
      async () => 'read',
      async () => {
        throw uniqueError(TASK_KEY_INDEX);
      },
      never,
    );
    await expect(out).rejects.toBeInstanceOf(ConflictException);
  });

  it('two at once, the winner gone already (a draft discarded): 404', async () => {
    const { database } = fakeDatabase([fakeTx({}).tx, fakeTx({}).tx]);
    const out = keyedSave(
      database,
      FIRM,
      actor,
      keyed(KEY),
      async () => 'read',
      async () => {
        throw uniqueError(TASK_KEY_INDEX);
      },
      never,
    );
    await expect(out).rejects.toBeInstanceOf(NotFoundException);
  });

  it('any other error goes to `otherwise`: another index, the series index on a task, or no key', async () => {
    for (const [key, error] of [
      [KEY, uniqueError('task_reminders_one_days_rule')],
      [KEY, uniqueError(SERIES_KEY_INDEX)],
      [undefined, uniqueError(TASK_KEY_INDEX)],
      [KEY, new Error('connection lost')],
    ] as const) {
      const { database, opened } = fakeDatabase([fakeTx({}).tx, fakeTx({}).tx]);
      const out = keyedSave(
        database,
        FIRM,
        actor,
        keyed(key),
        async () => 'read',
        async () => {
          throw error;
        },
        (e) => {
          throw Object.assign(new Error('mapped'), { cause: e });
        },
      );
      await expect(out).rejects.toMatchObject({ message: 'mapped', cause: error });
      expect(opened).toHaveLength(1);
    }
  });
});
