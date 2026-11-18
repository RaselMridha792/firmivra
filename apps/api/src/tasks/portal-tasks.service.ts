import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { MyTask, MyTaskRow, MyTaskStatus } from '@firmivra/types';
import { timeOfDayFromDb } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import { hiddenInPortal } from '../bookkeeping/portal-defaults.js';
import { DATABASE } from '../database/database.module.js';
import {
  LIVE_DOCUMENT,
  notFound,
  type PortalCaller,
  portalLogin,
} from '../storage/document-records.js';

/**
 * The client tasks of Client Portal Review One T16 (Tasks Review T16 with T12): the tasks the
 * firm marks visible to the client (`clientVisible`), in the portal's Requests area. The client
 * comes from the session's login, never the URL; another client's task, or one not visible,
 * is 404. Only the approved fields leave: title, instructions, where it stands, the due date and
 * the checklist; never internal notes, the assignee, priority, a blocked reason or a related
 * record. Attachments: only the ones approved one by one (`TaskAttachment.clientVisible`), never
 * an INTERNAL or removed document, and only for a household login (PRIMARY or SPOUSE), as the
 * firm's shared files are (an AUTHORIZED login sees none of them). Reads are audited, ids only.
 * Bookkeeping's Portal Defaults (BK-CP4): a Bookkeeping service with Tasks off keeps its tasks out
 * of the portal (and one of them is 404); a task of no service, or of any other, still shows.
 */
const VISIBLE = {
  clientVisible: true,
  archivedAt: null,
  leadId: null,
  status: { in: ['OPEN', 'DONE'] },
} as const satisfies Prisma.TaskWhereInput;

const PROGRESS: Record<string, MyTaskStatus> = {
  NOT_STARTED: 'TO_DO',
  PENDING: 'TO_DO',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING_ON_YOU',
  BLOCKED: 'ON_HOLD',
};

const select = {
  id: true,
  title: true,
  status: true,
  progress: true,
  dueOn: true,
  dueTime: true,
  allDay: true,
  taskChecklistItems: {
    select: { id: true, label: true, completedAt: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.TaskSelect;
type Row = Prisma.TaskGetPayload<{ select: typeof select }>;

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/**
 * BK-CP4: leaves out the tasks of the client's Bookkeeping services whose Tasks default is off.
 * The OR keeps a task of no service: `engagementId` is nullable, and NOT IN would drop it.
 */
async function shownServices(
  tx: TxClient,
  businessId: string,
  clientId: string,
): Promise<Prisma.TaskWhereInput> {
  const hidden = await hiddenInPortal(tx, businessId, clientId, 'tasks');
  return hidden.length ? { OR: [{ engagementId: null }, { engagementId: { notIn: hidden } }] } : {};
}

function toRow(t: Row): MyTaskRow {
  return {
    id: t.id,
    title: t.title,
    status: t.status === 'DONE' ? 'COMPLETED' : (PROGRESS[t.progress] ?? 'TO_DO'),
    dueOn: day(t.dueOn),
    dueTime: t.dueOn && !t.allDay && t.dueTime ? timeOfDayFromDb(t.dueTime) : null,
    checklist: {
      done: t.taskChecklistItems.filter((i) => i.completedAt !== null).length,
      total: t.taskChecklistItems.length,
    },
  };
}

@Injectable()
export class PortalTasksService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The client's visible tasks: open ones first, soonest due first, then the completed ones. */
  async list(caller: PortalCaller): Promise<MyTaskRow[]> {
    const { rows, clientId } = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      if (!login.clientId) return { rows: [], clientId: null };
      const shown = await shownServices(tx, caller.businessId, login.clientId);
      const rows = await tx.task.findMany({
        where: { businessId: caller.businessId, clientId: login.clientId, ...VISIBLE, ...shown },
        orderBy: [{ status: 'desc' }, { dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 200,
        select,
      });
      return { rows, clientId: login.clientId };
    });
    // OPEN sorts after DONE by name; the client wants the open ones first.
    const items = [...rows]
      .sort((a, b) => Number(a.status === 'DONE') - Number(b.status === 'DONE'))
      .map(toRow);
    if (clientId)
      await this.audit.log(
        'portal_tasks.listed',
        { type: 'client', id: clientId },
        { count: items.length, clientAccountId: caller.clientAccountId },
      );
    return items;
  }

  /** One visible task with its checklist and the attachments approved for the client. */
  async get(caller: PortalCaller, id: string): Promise<MyTask> {
    const task = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      if (!login.clientId) return null;
      const shown = await shownServices(tx, caller.businessId, login.clientId);
      const row = await tx.task.findFirst({
        where: {
          businessId: caller.businessId,
          id,
          clientId: login.clientId,
          ...VISIBLE,
          ...shown,
        },
        select: {
          ...select,
          details: true,
          taskAttachments: {
            where: {
              clientVisible: true,
              document: {
                clientId: login.clientId,
                direction: { not: 'INTERNAL' },
                ...LIVE_DOCUMENT,
              },
            },
            select: { document: { select: { id: true, fileName: true } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      });
      return row ? { row, clientId: login.clientId, household: login.household } : null;
    });
    if (!task) throw notFound();
    const { row, clientId, household } = task;
    await this.audit.log(
      'portal_task.viewed',
      { type: 'task', id: row.id },
      { clientId, clientAccountId: caller.clientAccountId },
    );
    return {
      ...toRow(row),
      details: row.details,
      checklistItems: row.taskChecklistItems.map((i) => ({
        id: i.id,
        label: i.label,
        done: i.completedAt !== null,
      })),
      // An AUTHORIZED login sees none of the firm's files (as in My Documents).
      attachments: household
        ? row.taskAttachments.map((a) => ({
            documentId: a.document.id,
            fileName: a.document.fileName,
          }))
        : [],
    };
  }
}
