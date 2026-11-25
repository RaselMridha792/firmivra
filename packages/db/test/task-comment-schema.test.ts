import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

async function taskA() {
  return A().task.create({
    data: { businessId: f.firmA, clientId: f.clientA, title: 'Synthetic task discussion' },
  });
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'q36comment');
});

describe('task comments', () => {
  it('keeps comments attached to a task and firm member', async () => {
    const task = await taskA();
    const comment = await A().taskComment.create({
      data: {
        businessId: f.firmA,
        taskId: task.id,
        authorUserId: f.memberA,
        body: 'Internal synthetic comment.',
      },
    });
    expect(comment).toMatchObject({ taskId: task.id, authorUserId: f.memberA });
    expect(await A().taskComment.findMany({ where: { taskId: task.id } })).toHaveLength(1);
    expect(await B().taskComment.findMany()).toEqual([]);

    expect(
      await failure(
        A().taskComment.create({
          data: {
            businessId: f.firmA,
            taskId: task.id,
            authorUserId: f.memberB,
            body: 'Wrong-firm author.',
          },
        }),
      ),
    ).toMatch(/foreign key/i);
  });

  it("rejects another firm's task and blank comments", async () => {
    const task = await taskA();
    const taskB = await B().task.create({
      data: { businessId: f.firmB, clientId: f.clientB, title: 'Other synthetic task' },
    });

    expect(
      await failure(
        B().taskComment.create({
          data: {
            businessId: f.firmB,
            taskId: task.id,
            authorUserId: f.memberB,
            body: 'Cross-firm task link.',
          },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(
      await failure(
        A().taskComment.create({
          data: {
            businessId: f.firmA,
            taskId: task.id,
            authorUserId: f.memberA,
            body: '   ',
          },
        }),
      ),
    ).toMatch(/task_comments_body_not_blank/i);
    expect(taskB.businessId).toBe(f.firmB);
  });
});
