// The Tasks mock's drafts (contract: packages/types/src/tasks/drafts.ts), so the Drafts tab built
// in mock mode behaves as the API does: a clientless draft is its creator's only, publishing needs
// a client and turns the draft into one OPEN task with the same id.
import { describe, expect, it } from 'vitest';
import { createTaskWorkMock } from '../mocks/tasks-work';

const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

describe('task work mock: drafts', () => {
  it('saves, finds, edits and publishes a draft as one task', async () => {
    const api = createTaskWorkMock({ empty: true });
    const saved = await api.saveDraft({ title: 'Prepare plan', priority: 'HIGH' });
    expect(saved).toMatchObject({ status: 'DRAFT', client: null, missing: ['clientId'] });

    const found = await api.drafts({ search: 'prep', priority: 'HIGH' });
    expect(found.items.map((d) => d.id)).toEqual([saved.id]);
    expect((await api.overview()).total).toBe(0);

    await expect(api.publishDraft(saved.id)).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'clientId', message: 'Choose a client' }],
    });
    const edited = await api.updateDraft(saved.id, { clientId: JAMIE, version: saved.version });
    expect(edited.missing).toEqual([]);

    const task = await api.publishDraft(saved.id, { dueOn: '2026-11-02' });
    expect(task).toMatchObject({ id: saved.id, status: 'OPEN', dueOn: '2026-11-02' });
    expect((await api.drafts()).total).toBe(0);
    expect((await api.overview()).items.map((t) => t.id)).toEqual([saved.id]);
  });

  it('keeps a clientless draft to its creator and refuses a stale edit', async () => {
    const owner = createTaskWorkMock({ role: 'OWNER' });
    const staff = createTaskWorkMock({ role: 'STAFF' });
    expect((await staff.drafts()).items.map((d) => d.title)).toEqual([
      'Follow up on missing receipts',
    ]);
    const clientless = (await owner.drafts()).items.find((d) => d.client === null);
    expect(clientless).toBeDefined();
    await expect(staff.draft(clientless!.id)).rejects.toMatchObject({ status: 404 });

    const d = await owner.draft(clientless!.id);
    await owner.updateDraft(d.id, { title: 'Renamed' });
    await expect(
      owner.updateDraft(d.id, { title: 'Again', version: d.version }),
    ).rejects.toMatchObject({ status: 409, code: 'SAVE_CONFLICT' });
    await owner.discardDraft(d.id);
    await expect(owner.draft(d.id)).rejects.toMatchObject({ status: 404 });
  });
});
