import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { BulkTaskResult } from '@firmivra/types';
import type { z } from 'zod';
import { addDays } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { notAMember, notFound } from '../workspaces/common.js';
import { LIVE_TASK } from './task-common.js';
import type { BulkTaskRequest } from './task-input.js';
import { reach } from './task-read.service.js';
import { TaskWriteService } from './task-write.service.js';

type Body = z.output<typeof BulkTaskRequest>;

/** The safe reason a task was left out: the error's code, else a generic one (never a message). */
function reasonOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const code =
      typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    if (typeof code === 'string') return code;
    if (error.getStatus() === 404) return 'NOT_FOUND';
  }
  throw error;
}

/**
 * Bulk actions on up to 100 tasks (Reassign, Stage, Due date, Priority, Complete, Cancel,
 * Archive). Each task changes on its own through the same code as a single change (so the same
 * rules, locks and audit row apply to it); one that does not fit is skipped with a safe reason
 * code and the rest still change. One more audit row says the action, how many changed and the
 * ids. A task out of the caller's reach is skipped as NOT_FOUND, never revealed.
 */
@Injectable()
export class TaskBulkService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly writer: TaskWriteService,
  ) {}

  async run(businessId: string, actor: ClientsActor, body: Body): Promise<BulkTaskResult> {
    // Someone who is not a member of the firm is a mistake in the request, for every task alike.
    if (body.action === 'REASSIGN' && body.assignedUserId) {
      const assignee = body.assignedUserId;
      const member = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
        tx.membership.count({ where: { businessId, userId: assignee, status: 'ACTIVE' } }),
      );
      if (member === 0) throw notAMember();
    }
    const ids = [...new Set(body.ids.map((i) => i.toLowerCase()))];
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        await this.one(businessId, actor, id, body);
        updated.push(id);
      } catch (error) {
        skipped.push({ id, reason: reasonOf(error) });
      }
    }
    // Nothing found at all is a 404, as for one task, so naming another firm's tasks is no probe.
    if (updated.length === 0 && skipped.every((s) => s.reason === 'NOT_FOUND')) throw notFound();
    await this.audit.log(
      'tasks.bulk',
      { type: 'task' },
      { action: body.action, requested: ids.length, updated: updated.length, ids: updated },
    );
    return { updated: updated.length, skipped };
  }

  private async one(businessId: string, actor: ClientsActor, id: string, body: Body) {
    switch (body.action) {
      case 'REASSIGN':
        return this.writer.update(businessId, actor, id, { assignedUserId: body.assignedUserId });
      case 'SET_PROGRESS':
        return this.writer.setProgress(businessId, actor, id, body.progress);
      case 'SET_PRIORITY':
        return this.writer.update(businessId, actor, id, { priority: body.priority });
      case 'COMPLETE':
        return this.writer.complete(businessId, actor, id);
      case 'CANCEL':
        return this.writer.cancel(businessId, actor, id);
      case 'ARCHIVE':
        return this.writer.archive(businessId, actor, id);
      case 'SET_DUE_DATE': {
        if (body.dueOn !== undefined) {
          return this.writer.update(businessId, actor, id, { dueOn: body.dueOn });
        }
        const due = await this.dueOf(businessId, actor, id);
        // A task with no date has nothing to shift.
        if (!due) throw new HttpException({ code: 'NO_DUE_DATE' }, 409);
        return this.writer.update(businessId, actor, id, {
          dueOn: addDays(due, body.shiftDays ?? 0),
        });
      }
    }
  }

  private dueOf(businessId: string, actor: ClientsActor, id: string): Promise<string | null> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx: TxClient) => {
      const t = await tx.task.findFirst({
        where: { businessId, id, ...LIVE_TASK, ...reach(actor) },
        select: { dueOn: true },
      });
      if (!t) throw new HttpException({ code: 'NOT_FOUND' }, 404);
      return t.dueOn ? t.dueOn.toISOString().slice(0, 10) : null;
    });
  }
}
