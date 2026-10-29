// A deadline's Create Task key (R1, Oct 29; migration r1_task_deadline_scope, Octavia's CD-F01):
// the scope 'deadline:<deadline id>' joins the task scopes, so the fixed key the API makes from
// the deadline and the template (or none) keeps one task per pair, also without a template. Tasks
// without a key (linked by hand) still repeat, and a firm never sees, finds or changes another
// firm's keyed task. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { databaseErrorCode } from '../src/errors.js';
import { connect, createTwoFirms, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let deadlineA: string;
let deadlineB: string;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
type Firm = 'A' | 'B';
const firm = (x: Firm) =>
  x === 'A'
    ? { db: A(), businessId: f.firmA, clientId: f.clientA, userId: f.memberA }
    : { db: B(), businessId: f.firmB, clientId: f.clientB, userId: f.memberB };
const select = {
  id: true,
  deadlineId: true,
  idempotencyKey: true,
  idempotencyScope: true,
} as const;

/** A task of the firm's client by its member, with these columns. */
const task = (data: Record<string, unknown> = {}, x: Firm = 'A') => {
  const { db: client, businessId, clientId, userId } = firm(x);
  return client.task.create({
    data: { businessId, clientId, createdByUserId: userId, title: 'Deadline task (fake)', ...data },
    select,
  });
};
/** What a deadline's Create Task writes: the deadline, and its key with the deadline's scope. */
const forDeadline = (deadlineId: string, key = randomUUID()) => ({
  deadlineId,
  idempotencyKey: key,
  idempotencyScope: `deadline:${deadlineId}`,
});

/** '' when the write went through, otherwise "<SQLSTATE> <message and meta>". */
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
  f = await createTwoFirms(owner, 'r1tdk');
  const deadline = (x: Firm) => {
    const { db: client, businessId, clientId } = firm(x);
    return client.complianceDeadline.create({
      data: {
        businessId,
        clientId,
        name: 'Q4 Estimated Tax (fake)',
        type: 'ESTIMATED_TAX',
        dueOn: new Date('2027-01-15'),
      },
      select: { id: true },
    });
  };
  deadlineA = (await deadline('A')).id;
  deadlineB = (await deadline('B')).id;
});

describe("a deadline's Create Task", () => {
  it('takes the deadline scope, and its key a second time is refused (23505)', async () => {
    const key = randomUUID();
    await expect(task(forDeadline(deadlineA, key))).resolves.toMatchObject({
      deadlineId: deadlineA,
      idempotencyKey: key,
      idempotencyScope: `deadline:${deadlineA}`,
    });
    // A double-click, a refresh or a retry sends the same fixed key.
    expect(await refusal(task(forDeadline(deadlineA, key)))).toMatch(
      /^23505 .*tasks_business_id_idempotency_key_key/s,
    );
    expect(await A().task.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('takes the scope only as the API writes it, and the other scopes still (23514)', async () => {
    const source = (await task()).id;
    for (const scope of ['create', `duplicate:${source}`]) {
      await expect(
        task({ idempotencyKey: randomUUID(), idempotencyScope: scope }),
      ).resolves.toMatchObject({ idempotencyScope: scope });
    }
    for (const scope of [
      'deadline',
      'deadline:',
      `Deadline:${deadlineA}`,
      ` deadline:${deadlineA}`,
      `deadline:${deadlineA} `,
      `deadline:${deadlineA.toUpperCase()}`,
      `deadline:${deadlineA}x`,
      `deadline:${deadlineA.replaceAll('-', '')}`,
      'deadline:not-a-deadline',
      `deadlines:${deadlineA}`,
    ]) {
      expect(
        await refusal(
          task({ deadlineId: deadlineA, idempotencyKey: randomUUID(), idempotencyScope: scope }),
        ),
        scope,
      ).toMatch(/^23514 .*tasks_idempotency_scope/s);
    }
  });

  it('still lets tasks without a key repeat on one deadline (linked by hand)', async () => {
    const made = [await task({ deadlineId: deadlineA }), await task({ deadlineId: deadlineA })];
    for (const row of made) {
      expect(row).toMatchObject({ deadlineId: deadlineA, idempotencyKey: null });
    }
  });
});

describe('isolation', () => {
  it("another firm may use the same key, and never sees, finds or changes firm A's task", async () => {
    const key = randomUUID();
    const a = await task(forDeadline(deadlineA, key));
    const b = await task(forDeadline(deadlineB, key), 'B');
    expect(b.id).not.toBe(a.id);

    expect(await B().task.findMany({ where: { idempotencyKey: key } })).toEqual([
      expect.objectContaining({ id: b.id }),
    ]);
    expect(await B().task.findMany({ where: { deadlineId: deadlineA } })).toEqual([]);
    const { count } = await B().task.updateMany({
      where: { id: a.id },
      data: { title: 'Changed by firm B' },
    });
    expect(count).toBe(0);
    await expect(A().task.findUniqueOrThrow({ where: { id: a.id } })).resolves.toMatchObject({
      title: 'Deadline task (fake)',
    });
  });

  it("never puts a task on another firm's deadline", async () => {
    // The same-client rule finds no such deadline under firm B's RLS, before the foreign key.
    expect(await refusal(task(forDeadline(deadlineA), 'B'))).toMatch(
      /deadline's client|foreign key|23503/i,
    );
  });
});
