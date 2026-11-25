import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

async function taskA() {
  return A().task.create({
    data: { businessId: f.firmA, clientId: f.clientA, title: 'Synthetic task acknowledgement' },
  });
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'q36ack');
});

describe('task acknowledgements', () => {
  it('stores one state per task assignee, including additional assignees', async () => {
    const task = await taskA();
    const dueAt = new Date('2026-11-25T15:00:00.000Z');
    const primary = await A().taskAcknowledgement.create({
      data: {
        businessId: f.firmA,
        taskId: task.id,
        assigneeUserId: f.memberA,
        required: true,
        dueAt,
      },
    });
    const additional = await A().taskAcknowledgement.create({
      data: {
        businessId: f.firmA,
        taskId: task.id,
        assigneeUserId: f.member2A,
        required: true,
        dueAt,
      },
    });

    expect(primary).toMatchObject({ required: true, dueAt, acknowledgedAt: null });
    expect(additional.assigneeUserId).toBe(f.member2A);
    expect(await A().taskAcknowledgement.count({ where: { taskId: task.id } })).toBe(2);
    expect(
      await failure(
        A().taskAcknowledgement.create({
          data: {
            businessId: f.firmA,
            taskId: task.id,
            assigneeUserId: f.memberA,
            required: true,
            dueAt,
          },
        }),
      ),
    ).toMatch(/unique/i);
  });

  it('defaults to no acknowledgement requirement and rejects partial state', async () => {
    const task = await taskA();
    await expect(
      A().taskAcknowledgement.create({
        data: {
          businessId: f.firmA,
          taskId: task.id,
          assigneeUserId: f.memberA,
        },
      }),
    ).resolves.toMatchObject({ required: false, dueAt: null, acknowledgedAt: null });

    expect(
      await failure(
        A().taskAcknowledgement.create({
          data: {
            businessId: f.firmA,
            taskId: task.id,
            assigneeUserId: f.member2A,
            required: true,
          },
        }),
      ),
    ).toMatch(/task_acknowledgements_required_state/i);
    expect(
      await failure(
        A().taskAcknowledgement.create({
          data: {
            businessId: f.firmA,
            taskId: task.id,
            assigneeUserId: f.memberB,
            required: true,
            dueAt: new Date('2026-11-25T15:00:00.000Z'),
            acknowledgedAt: new Date('2026-11-25T14:00:00.000Z'),
          },
        }),
      ),
    ).toMatch(/task_acknowledgements_recorder_pair/i);
  });

  it('accepts a single reminder at or after the due time', async () => {
    const task = await taskA();
    const dueAt = new Date('2026-11-25T15:00:00.000Z');
    await expect(
      A().taskAcknowledgement.create({
        data: {
          businessId: f.firmA,
          taskId: task.id,
          assigneeUserId: f.memberA,
          required: true,
          dueAt,
          reminderSentAt: new Date('2026-11-25T15:00:00.000Z'),
        },
      }),
    ).resolves.toMatchObject({ reminderSentAt: dueAt });

    const other = await taskA();
    expect(
      await failure(
        A().taskAcknowledgement.create({
          data: {
            businessId: f.firmA,
            taskId: other.id,
            assigneeUserId: f.memberA,
            required: true,
            dueAt,
            reminderSentAt: new Date('2026-11-25T14:59:00.000Z'),
          },
        }),
      ),
    ).toMatch(/task_acknowledgements_reminder_due/i);
  });

  it('rejects another firm assignee and hides acknowledgement rows across firms', async () => {
    const task = await taskA();
    await expect(
      A().taskAcknowledgement.create({
        data: {
          businessId: f.firmA,
          taskId: task.id,
          assigneeUserId: f.memberB,
          required: true,
          dueAt: new Date('2026-11-25T15:00:00.000Z'),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await A().taskAcknowledgement.create({
      data: { businessId: f.firmA, taskId: task.id, assigneeUserId: f.memberA },
    });
    expect(await B().taskAcknowledgement.findMany()).toEqual([]);
  });
});
