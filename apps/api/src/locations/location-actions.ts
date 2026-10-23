import type { Prisma, TxClient } from '@firmivra/db';
import { ROLES_MANAGED_BY } from '@firmivra/types';
import type { AuditService } from '../audit/audit.service.js';
import { deactivateMemberIn } from '../staff/staff-actions.service.js';
import { type Decision, decide, errors } from './locations-common.js';

// Running a Locations change (firm_office_actions): "now" in the request's transaction, or by
// location-actions.job.ts once due. Either way the action row is PENDING first and then DONE or
// FAILED (the database's trigger: DONE only once due, a finished row never changes), so history
// and audit are the same for both.

export type ActionRow = Prisma.FirmOfficeActionGetPayload<object>;

/** One firm's Locations writes run one at a time (the plan's limit, the main location, conflicts). */
export const lockLocations = (tx: TxClient, businessId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`firm-offices:${businessId}`}, 0))`;

/** The database's clock, to the millisecond and never ahead of it (an action is due at it). */
export async function dbNow(tx: TxClient): Promise<Date> {
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT date_trunc('milliseconds', now()) AS now`;
  return new Date(row!.now);
}

/** Refuses a pending change matching `where` (409 PENDING_ACTION_EXISTS), `except` aside. */
export async function noPending(
  tx: TxClient,
  businessId: string,
  where: Prisma.FirmOfficeActionWhereInput,
  except?: string,
): Promise<void> {
  const found = await tx.firmOfficeAction.findFirst({
    where: { businessId, status: 'PENDING', ...(except ? { id: { not: except } } : {}), ...where },
    select: { id: true },
  });
  if (found) throw errors.pendingExists();
}

/** What a due action would do now, from the firm's current state. */
export async function decideNow(tx: TxClient, businessId: string, a: ActionRow): Promise<Decision> {
  const member = (userId: string | null) =>
    userId
      ? tx.membership.findFirst({
          where: { businessId, userId },
          select: { role: true, status: true },
        })
      : Promise.resolve(null);
  if (a.kind !== 'DEACTIVATE_MANAGER') {
    const office = a.officeId
      ? await tx.firmOffice.findFirst({
          where: { businessId, id: a.officeId },
          select: { archivedAt: true, isMain: true },
        })
      : null;
    const next = a.kind === 'REASSIGN_MANAGER' ? await member(a.newManagerUserId) : null;
    return decide({
      kind: a.kind,
      office: office ? { live: office.archivedAt === null, isMain: office.isMain } : null,
      newManagerActive: a.kind === 'REASSIGN_MANAGER' ? next?.status === 'ACTIVE' : null,
    });
  }
  const [target, creator, replacement] = await Promise.all([
    member(a.managerUserId),
    member(a.createdByUserId),
    member(a.newManagerUserId),
  ]);
  return decide({
    kind: a.kind,
    managerAllowed:
      !!target &&
      (target.status === 'DEACTIVATED' ||
        (!!creator && ROLES_MANAGED_BY[creator.role].includes(target.role))),
    newManagerActive: a.newManagerUserId ? replacement?.status === 'ACTIVE' : null,
  });
}

/**
 * Does what the action says, in the caller's transaction, with an audit row per change:
 * DEACTIVATE_LOCATION makes the location INACTIVE (its appointments and staff stay);
 * REASSIGN_MANAGER gives the location its new manager; DEACTIVATE_MANAGER gives every live
 * location the manager runs the replacement (none: the main location's manager acts) and ends the
 * manager's access exactly as Staff Management's Deactivate does. Nobody else is deactivated.
 */
export async function applyAction(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  a: ActionRow,
): Promise<void> {
  const at = { businessId };
  if (a.kind === 'DEACTIVATE_LOCATION' && a.officeId) {
    await tx.firmOffice.updateMany({
      where: { businessId, id: a.officeId, status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });
    await audit.logIn(
      tx,
      'firm_office.deactivated',
      { type: 'firm_office', id: a.officeId },
      { officeId: a.officeId, actionId: a.id },
      at,
    );
    return;
  }
  if (a.kind === 'REASSIGN_MANAGER' && a.officeId) {
    await tx.firmOffice.updateMany({
      where: { businessId, id: a.officeId },
      data: { managerUserId: a.newManagerUserId },
    });
    await audit.logIn(
      tx,
      'firm_office.manager_reassigned',
      { type: 'firm_office', id: a.officeId },
      { officeId: a.officeId, actionId: a.id, acting: false },
      at,
    );
    return;
  }
  if (a.kind === 'DEACTIVATE_MANAGER' && a.managerUserId) {
    const offices = await tx.firmOffice.findMany({
      where: { businessId, managerUserId: a.managerUserId, archivedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (offices.length) {
      await tx.firmOffice.updateMany({
        where: { businessId, id: { in: offices.map((o) => o.id) } },
        data: { managerUserId: a.newManagerUserId },
      });
    }
    for (const o of offices) {
      await audit.logIn(
        tx,
        'firm_office.manager_reassigned',
        { type: 'firm_office', id: o.id },
        { officeId: o.id, actionId: a.id, acting: a.newManagerUserId === null },
        at,
      );
    }
    const target = await tx.membership.findFirst({
      where: { businessId, userId: a.managerUserId },
      select: { id: true, userId: true, role: true, status: true },
    });
    if (target && target.status !== 'DEACTIVATED')
      await deactivateMemberIn(tx, audit, businessId, target, false);
  }
}

const actionMeta = (a: ActionRow) => ({ actionId: a.id, kind: a.kind, officeId: a.officeId });

/** The action ran: DONE (the database sets finished_at), audited. */
export async function finishDone(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  a: ActionRow,
  immediate: boolean,
): Promise<ActionRow> {
  const done = await tx.firmOfficeAction.update({ where: { id: a.id }, data: { status: 'DONE' } });
  await audit.logIn(
    tx,
    'firm_office_action.done',
    { type: 'firm_office_action', id: a.id },
    { ...actionMeta(a), immediate },
    { businessId },
  );
  return done;
}

/** The action could not run: FAILED with its code, audited. */
export async function finishFailed(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  a: ActionRow,
  code: string,
): Promise<ActionRow> {
  const failed = await tx.firmOfficeAction.update({
    where: { id: a.id },
    data: { status: 'FAILED', failureCode: code },
  });
  await audit.logIn(
    tx,
    'firm_office_action.failed',
    { type: 'firm_office_action', id: a.id },
    { ...actionMeta(a), code },
    { businessId },
  );
  return failed;
}

/** A new action: PENDING, written as scheduled (the database keeps the first time too). */
export async function insertAction(
  tx: TxClient,
  businessId: string,
  data: {
    kind: ActionRow['kind'];
    officeId: string | null;
    managerUserId: string | null;
    newManagerUserId: string | null;
    effectiveAt: Date;
    createdByUserId: string;
  },
): Promise<ActionRow> {
  return tx.firmOfficeAction.create({ data: { businessId, ...data } });
}
