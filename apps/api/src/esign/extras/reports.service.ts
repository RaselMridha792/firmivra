import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  type EsignReport,
  type EsignReportQuery,
  type EsignReportTotals,
  EsignRequestStatus,
} from '@firmivra/types';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { type EsignActor, seesAll } from '../requests/requests.service.js';
import {
  type EsignExtrasRepository,
  type EsignReportRow,
  EXTRAS_REPOSITORY,
} from './extras.repository.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const OUTSTANDING = ['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'] as const;

/** How far `tz` is ahead of UTC at instant `t`, in milliseconds (whole seconds). */
function offsetAt(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    ...{ year: 'numeric', month: 'numeric', day: 'numeric' },
    ...{ hour: 'numeric', minute: 'numeric', second: 'numeric' },
  }).formatToParts(t);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - Math.floor(t / 1000) * 1000;
}

/** The instant a calendar day (YYYY-MM-DD) starts in `tz`. */
export function dayStart(day: string, tz: string): Date {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const guess = utc - offsetAt(utc, tz);
  // Again at the guess, in case an offset change falls between (daylight saving time).
  return new Date(utc - offsetAt(guess, tz));
}

/** The numbers for some rows (one sender's, or all of them). */
function totals(rows: EsignReportRow[]): EsignReportTotals {
  const count = (...statuses: readonly EsignRequestStatus[]) =>
    rows.reduce((n, r) => n + statuses.reduce((m, s) => m + (r.counts[s] ?? 0), 0), 0);
  const sent = count(...EsignRequestStatus.options);
  const completed = count('COMPLETED');
  const ms = rows.reduce((n, r) => n + r.completionMs, 0);
  return {
    sent,
    completed,
    outstanding: count(...OUTSTANDING),
    declined: count('DECLINED'),
    expired: count('EXPIRED'),
    voided: count('VOIDED'),
    completionRate: sent ? completed / sent : null,
    averageCompletionHours: completed ? Math.round((ms / completed / HOUR_MS) * 10) / 10 : null,
  };
}

/**
 * GET /esign/reports (R13, contract 3): the requests sent in a range of calendar days (inclusive,
 * in the firm's time zone; the query allows at most a year), with totals and one row per sender,
 * most sent first. Owner and Admin count the whole firm; everyone else (Viewers too) only the
 * requests they may open, as the list. Counts and names only, so it is not audited.
 */
@Injectable()
export class EsignReportsService {
  constructor(
    @Inject(EXTRAS_REPOSITORY) private readonly extras: Pick<EsignExtrasRepository, 'report'>,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
  ) {}

  async report(
    businessId: string,
    actor: EsignActor,
    query: z.output<typeof EsignReportQuery>,
  ): Promise<EsignReport> {
    const { timeZone } = await this.directory.firm(businessId);
    const next = new Date(Date.parse(`${query.to}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    const rows = await this.extras.report(businessId, {
      visibleTo: seesAll(actor) ? null : actor.userId,
      sentFrom: dayStart(query.from, timeZone),
      sentBefore: dayStart(next, timeZone),
      ...(query.status && { status: query.status }),
      ...(query.senderId && { senderUserId: query.senderId }),
    });
    const bySender = await Promise.all(
      rows.map(async (r) => {
        const member = await this.directory.member(businessId, r.senderUserId);
        return { sender: { userId: r.senderUserId, name: member?.name ?? '' }, ...totals([r]) };
      }),
    );
    bySender.sort((x, y) => y.sent - x.sent || x.sender.name.localeCompare(y.sender.name));
    return { from: query.from, to: query.to, totals: totals(rows), bySender };
  }
}
