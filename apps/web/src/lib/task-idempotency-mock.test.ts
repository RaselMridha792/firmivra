// The Tasks mock's idempotency keys (contract: packages/types/src/tasks/work.ts IdempotencyKey), so
// a screen built in mock mode retries as it would against the API: a retry of Create, Save as
// Draft, Duplicate, Set Up Recurring or Convert with its key returns the first record; another
// member, route or task gets 409 IDEMPOTENCY_KEY_REUSED.
import { describe, expect, it } from 'vitest';
import { createTaskWorkMock } from '../mocks/tasks-work';

const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
const newKey = () => crypto.randomUUID();
const reused = { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' };

describe('task work mock: idempotency keys', () => {
  it('a retry with the key returns the first task, draft, copy or series', async () => {
    // The seeded firm: a series needs one of its task types.
    const api = createTaskWorkMock();
    const count = async () => ({
      tasks: (await api.overview({ pageSize: 100 })).total,
      drafts: (await api.drafts()).total,
      series: (await api.seriesList()).total,
    });
    const before = await count();
    const k = newKey();
    const task = await api.create({
      clientId: JAMIE,
      title: 'Call back',
      dueOn: '2026-11-02',
      idempotencyKey: k,
    });
    const retry = await api.create({
      clientId: JAMIE,
      title: 'Changed',
      idempotencyKey: k.toUpperCase(),
    });
    expect(retry).toMatchObject({ id: task.id, title: 'Call back' });

    const d = newKey();
    const draft = await api.saveDraft({ title: 'Plan', idempotencyKey: d });
    expect((await api.saveDraft({ title: 'Plan', idempotencyKey: d })).id).toBe(draft.id);

    const c = newKey();
    const copy = await api.duplicate(task.id, { idempotencyKey: c });
    expect((await api.duplicate(task.id, { idempotencyKey: c })).id).toBe(copy.id);
    await expect(api.duplicate(copy.id, { idempotencyKey: c })).rejects.toMatchObject(reused);

    const s = newKey();
    const recurrence = { unit: 'MONTH' as const, startOn: '2026-11-02' };
    const made = await api.createSeries({
      clientId: JAMIE,
      title: 'Monthly',
      recurrence,
      idempotencyKey: s,
    });
    const again = await api.createSeries({
      clientId: JAMIE,
      title: 'Monthly',
      recurrence,
      idempotencyKey: s,
    });
    expect(again.id).toBe(made.id);

    const v = newKey();
    const converted = await api.convertToRecurring(task.id, {
      recurrence: { unit: 'MONTH' },
      idempotencyKey: v,
    });
    const reconverted = await api.convertToRecurring(task.id, {
      recurrence: { unit: 'WEEK' },
      idempotencyKey: v,
    });
    expect(reconverted.id).toBe(converted.id);
    // Each save made one record: the task and its copy, the draft, two series.
    expect(await count()).toEqual({
      tasks: before.tasks + 2,
      drafts: before.drafts + 1,
      series: before.series + 2,
    });
  });

  it('another member, route or task gets 409; a published draft’s key gives nothing back; a discarded draft frees its key', async () => {
    const owner = createTaskWorkMock({ role: 'OWNER', empty: true });
    const staff = createTaskWorkMock({ role: 'STAFF', empty: true });
    const k = newKey();
    await owner.create({ clientId: JAMIE, title: 'Mine', idempotencyKey: k });
    const recurrence = { unit: 'MONTH' as const, startOn: '2026-11-02' };
    for (const call of [
      () => staff.create({ clientId: JAMIE, title: 'Theirs', idempotencyKey: k }),
      () => owner.saveDraft({ title: 'Draft', idempotencyKey: k }),
      () => owner.createSeries({ clientId: JAMIE, title: 'S', recurrence, idempotencyKey: k }),
    ]) {
      await expect(call()).rejects.toMatchObject(reused);
    }

    const d = newKey();
    const draft = await owner.saveDraft({
      title: 'To publish',
      clientId: JAMIE,
      idempotencyKey: d,
    });
    await owner.publishDraft(draft.id);
    await expect(owner.saveDraft({ title: 'Again', idempotencyKey: d })).rejects.toMatchObject(
      reused,
    );

    const g = newKey();
    const gone = await owner.saveDraft({ title: 'Gone', idempotencyKey: g });
    await owner.discardDraft(gone.id);
    expect((await owner.saveDraft({ title: 'Fresh', idempotencyKey: g })).id).not.toBe(gone.id);
  });
});
