import { Injectable } from '@nestjs/common';
import type { AdminGrowth, AdminGrowthPoint, AdminGrowthQuery } from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from './admin-prisma.js';

type Query = z.output<typeof AdminGrowthQuery>;
type Bucket = AdminGrowth['bucket'];

/** The platform's calendar (SA-DSH-Y02: weeks start Monday, in US Eastern time). */
const PLATFORM_TIME_ZONE = 'America/New_York';
const DAY_MS = 86_400_000;
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: PLATFORM_TIME_ZONE });

/** The US Eastern calendar day of an instant, as YYYY-MM-DD. */
export const easternDay = (at: Date): string => eastern.format(at);

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => toDay(new Date(toDate(day).getTime() + n * DAY_MS));
const spanDays = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1;

/** Days for 31 days or fewer, weeks for up to 26 weeks (about six months), else months. */
export function bucketOf(from: string, to: string): Bucket {
  const days = spanDays(from, to);
  if (days <= 31) return 'DAY';
  if (days <= 26 * 7 + 6) return 'WEEK';
  return 'MONTH';
}

/**
 * The buckets of a range, in order: each day; each week from Monday to Sunday; each calendar
 * month. The first and last are cut to the range, so every day of it is in exactly one bucket.
 */
export function growthBuckets(
  from: string,
  to: string,
  bucket: Bucket = bucketOf(from, to),
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let start = from;
  while (start <= to) {
    let end: string;
    if (bucket === 'DAY') {
      end = start;
    } else if (bucket === 'WEEK') {
      // getUTCDay: 0 is Sunday; the week ends on Sunday.
      const weekday = toDate(start).getUTCDay();
      end = addDays(start, (7 - weekday) % 7);
    } else {
      const d = toDate(start);
      end = toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    }
    if (end > to) end = to;
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}

/** The index of the bucket holding `day`, or -1 outside the range (buckets are in order). */
function indexOf(buckets: readonly { start: string; end: string }[], day: string): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = buckets[mid]!;
    if (day < b.start) hi = mid - 1;
    else if (day > b.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Platform Growth on the Super Admin dashboard (SA-DSH-F06): applications submitted, firms set
 * up, active firms and Firmivra's revenue, by day, week or month over any range of up to two
 * years. Admin scope, as the signed-in Super Admin: platform tables only (applications, firms'
 * status and setup and closure times, Firmivra's own payments), never a firm's data.
 */
@Injectable()
export class DashboardGrowthService {
  constructor(private readonly admin: AdminPrisma) {}

  async growth(q: Query): Promise<AdminGrowth> {
    const bucket = bucketOf(q.from, q.to);
    const buckets = growthBuckets(q.from, q.to, bucket);
    // A day either side in UTC covers every Eastern day of the range; each row then goes to its
    // own Eastern day.
    const after = toDate(addDays(q.from, -1));
    const before = toDate(addDays(q.to, 2));
    const points: AdminGrowthPoint[] = buckets.map((b) => ({
      ...b,
      applications: 0,
      activations: 0,
      activeFirms: 0,
      revenueCents: 0,
    }));
    await this.admin.transaction(async (tx) => {
      const [applications, firms, payments] = await Promise.all([
        tx.firmApplication.findMany({
          where: { createdAt: { gte: after, lt: before } },
          select: { createdAt: true },
        }),
        tx.business.findMany({
          where: { activatedAt: { not: null, lt: before } },
          select: { activatedAt: true, closedAt: true },
        }),
        tx.platformPayment.findMany({
          where: {
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
            paidOn: { gte: toDate(q.from), lte: toDate(q.to) },
          },
          select: { paidOn: true, amountCents: true, refundedCents: true },
        }),
      ]);
      for (const a of applications) {
        const i = indexOf(buckets, easternDay(a.createdAt));
        if (i >= 0) points[i]!.applications += 1;
      }
      for (const f of firms) {
        const set = easternDay(f.activatedAt!);
        const closed = f.closedAt ? easternDay(f.closedAt) : null;
        const i = indexOf(buckets, set);
        if (i >= 0) points[i]!.activations += 1;
        for (const p of points) {
          if (set <= p.end && (closed === null || closed > p.end)) p.activeFirms += 1;
        }
      }
      for (const p of payments) {
        // A payment's day is a calendar date already (paid_on).
        const i = indexOf(buckets, toDay(p.paidOn));
        if (i >= 0) points[i]!.revenueCents += p.amountCents - p.refundedCents;
      }
    });
    return { from: q.from, to: q.to, bucket, points };
  }
}
