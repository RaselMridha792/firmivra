// tasks.related_text (R1, Nov 13; Tasks A1; migration r1_task_related_text): Related To in the
// firm's own words when no record fits. 1 to 200 characters, and a task has an engagement or this
// text, never both. Drafts (tasks too) take it the same way. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let engagementA = '';
const A = () => db.forBusiness(f.firmA);
const task = (data: Record<string, unknown>) =>
  A().task.create({ data: { businessId: f.firmA, title: 'Call the bank (fake)', ...data } });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1trt');
  engagementA = await createEngagement(owner, f.firmA, f.clientA);
});

describe('tasks.related_text', () => {
  it('keeps the custom text, on a task or a draft, never beside an engagement', async () => {
    await expect(
      task({ clientId: f.clientA, relatedText: 'Refinance of the rental (fake)' }),
    ).resolves.toMatchObject({ relatedText: 'Refinance of the rental (fake)' });
    await expect(
      task({ status: 'DRAFT', createdByUserId: f.memberA, relatedText: 'Draft note (fake)' }),
    ).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(task({ clientId: f.clientA, engagementId: engagementA })).resolves.toBeTruthy();
    for (const data of [
      { clientId: f.clientA, engagementId: engagementA, relatedText: 'Both (fake)' },
      { clientId: f.clientA, relatedText: ' ' },
      { clientId: f.clientA, relatedText: 'x'.repeat(201) },
    ]) {
      expect(await failure(task(data)), JSON.stringify(data).slice(0, 80)).toMatch(
        /tasks_related_text/,
      );
    }
    const t = await task({ clientId: f.clientA, relatedText: 'Before (fake)' });
    expect(
      await failure(A().task.update({ where: { id: t.id }, data: { engagementId: engagementA } })),
    ).toMatch(/tasks_related_text/);
  });

  it("is firm A's own: firm B sees none of it", async () => {
    await task({ clientId: f.clientA, relatedText: 'Private (fake)' });
    expect(
      await db.forBusiness(f.firmB).task.findMany({ where: { relatedText: 'Private (fake)' } }),
    ).toEqual([]);
  });
});
