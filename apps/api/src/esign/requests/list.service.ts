import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  ESIGN_COUNTERS,
  ESIGN_EXPIRING_SOON_DAYS,
  ESIGN_OPEN_STATUSES,
  ESIGN_RECENT_DAYS,
  EsignEvent,
  type EsignEventList,
  EsignQuickFilter,
  EsignRequestId,
  type EsignRequestList,
  type EsignRequestStatus,
  type EsignSummary,
  type ListEsignRequestsQuery,
} from '@firmivra/types';
import {
  ESIGN_REPOSITORY,
  type EsignListAfter,
  type EsignRepository,
  type EsignRequestFilter,
} from './esign.repository.js';
import { type EsignActor, EsignRequestsService, invalid, seesAll } from './requests.service.js';

const DAY = 24 * 60 * 60 * 1000;
type Query = z.output<typeof ListEsignRequestsQuery>;

/** Each quick filter's conditions, for the list and the counters alike. */
const QUICK: Record<EsignQuickFilter, (actor: EsignActor, now: number) => EsignRequestFilter> = {
  AWAITING_SIGNATURE: () => ({ visibleTo: null, statuses: ESIGN_OPEN_STATUSES }),
  EXPIRING_SOON: (_, now) => ({
    visibleTo: null,
    statuses: ESIGN_OPEN_STATUSES,
    expiresFrom: new Date(now),
    expiresBefore: new Date(now + ESIGN_EXPIRING_SOON_DAYS * DAY),
  }),
  RECENTLY_COMPLETED: (_, now) => ({
    visibleTo: null,
    statuses: ['COMPLETED'],
    completedFrom: new Date(now - ESIGN_RECENT_DAYS * DAY),
  }),
  MY_REQUESTS: (actor) => ({ visibleTo: null, senderUserId: actor.userId }),
  NEEDS_MY_APPROVAL: (actor) => ({
    visibleTo: null,
    statuses: ['NEEDS_APPROVAL'],
    pendingApprover: actor.userId,
  }),
};

/** Both filters (the first one's visibility); null when no request can match both. */
function both(a: EsignRequestFilter, b: EsignRequestFilter): EsignRequestFilter | null {
  if (a.senderUserId && b.senderUserId && a.senderUserId !== b.senderUserId) return null;
  const statuses =
    a.statuses && b.statuses ? a.statuses.filter((s) => b.statuses?.includes(s)) : undefined;
  if (statuses?.length === 0) return null;
  // Senders and statuses are the only conditions both may set (checked above).
  const merged = { ...a, ...b, visibleTo: a.visibleTo };
  return statuses ? { ...merged, statuses } : merged;
}

/** The opaque cursor: the last row's lastActivityAt and id. */
const encodeCursor = (after: EsignListAfter) =>
  Buffer.from(`${after.lastActivityAt.toISOString()}|${after.id}`).toString('base64url');
function decodeCursor(cursor: string): EsignListAfter {
  const [at, rawId, extra] = Buffer.from(cursor, 'base64url').toString().split('|');
  const lastActivityAt = new Date(at ?? '');
  const id = EsignRequestId.safeParse(rawId);
  if (extra !== undefined || !id.success || Number.isNaN(lastActivityAt.getTime())) {
    throw invalid('cursor', 'Invalid cursor');
  }
  return { lastActivityAt, id: id.data };
}

/**
 * Firm Sign's list, counters and timeline (R13 step 6, part 3). Owner and Admin see every request;
 * Staff, Managers and Viewers the ones they send, those of clients assigned to them and the ones
 * they approve (the same reach as GET /esign/requests/{id}). The list and the counters read no
 * client record beyond names, so they are not audited; the detail view is.
 */
@Injectable()
export class EsignListService {
  constructor(
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
  ) {}

  async list(businessId: string, actor: EsignActor, q: Query): Promise<EsignRequestList> {
    const after = q.cursor === undefined ? null : decodeCursor(q.cursor);
    const filter = this.filterOf(actor, q, Date.now());
    if (!filter) return { items: [], nextCursor: null };
    const rows = await this.repo.listRequests(businessId, filter, { after, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const items = await Promise.all(
      page.map((x) => this.requests.row(businessId, x.record, x.recipients, actor)),
    );
    const last = page.at(-1)?.record;
    return { items, nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null };
  }

  /** The 9 counters (DELIVERED counts as SENT) and the quick filters' counts. */
  async summary(businessId: string, actor: EsignActor): Promise<EsignSummary> {
    const now = Date.now();
    const visible = this.visible(actor);
    const byStatus = await this.repo.countRequests(businessId, visible);
    const counts = Object.fromEntries(
      ESIGN_COUNTERS.map((s) => [s, byStatus[s] ?? 0]),
    ) as EsignSummary['counts'];
    counts.SENT += byStatus.DELIVERED ?? 0;
    const quick = await Promise.all(
      EsignQuickFilter.options.map(async (k) => {
        const filter = both(visible, QUICK[k](actor, now));
        const found = filter ? await this.repo.countRequests(businessId, filter) : {};
        return [k, Object.values(found).reduce((sum, n) => sum + n, 0)] as const;
      }),
    );
    return { counts, quickFilters: Object.fromEntries(quick) as EsignSummary['quickFilters'] };
  }

  /**
   * The timeline, oldest first. EsignEvent's schema strips every key it does not name, so nothing
   * else a stored row holds (never a field value or content) leaves the API.
   */
  async events(businessId: string, actor: EsignActor, id: string): Promise<EsignEventList> {
    await this.requests.reach(businessId, actor, id, 'read');
    const events = await this.repo.events(businessId, id);
    const items = events.map((e) =>
      EsignEvent.parse({ ...e, createdAt: e.createdAt.toISOString() }),
    );
    return { items };
  }

  private visible(actor: EsignActor): EsignRequestFilter {
    return { visibleTo: seesAll(actor) ? null : actor.userId };
  }

  /** The query as a repository filter; null when nothing can match. */
  private filterOf(actor: EsignActor, q: Query, now: number): EsignRequestFilter | null {
    const statuses: EsignRequestStatus[] | undefined =
      q.status && (q.status === 'SENT' ? ['SENT', 'DELIVERED'] : [q.status]);
    const filter: EsignRequestFilter = {
      ...this.visible(actor),
      ...(statuses && { statuses }),
      ...(q.clientId && { clientId: q.clientId }),
      ...(q.senderId && { senderUserId: q.senderId }),
      ...(q.from && { lastActivityFrom: new Date(`${q.from}T00:00:00.000Z`) }),
      ...(q.to && { lastActivityBefore: new Date(Date.parse(`${q.to}T00:00:00.000Z`) + DAY) }),
      ...(q.q && { search: q.q }),
    };
    return q.quickFilter ? both(filter, QUICK[q.quickFilter](actor, now)) : filter;
  }
}
