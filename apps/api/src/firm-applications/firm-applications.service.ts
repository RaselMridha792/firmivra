import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FirmApplication, Prisma } from '@firmivra/db';
import {
  type AdminDashboard,
  type AdminRef,
  type BusinessSummary,
  type FirmApplicationCheck,
  type FirmApplicationCounts,
  type FirmApplicationEvent,
  type FirmApplicationListItem,
  FirmApplicationRecord,
  type FirmApplicationReviewStatus,
  type FirmCounts,
  type FirmListItem,
  type FirmRecord,
  type IndustryPack,
  ListFirmApplicationsQuery,
  type ListFirmApplicationsResponse,
  ListFirmsQuery,
  type ListFirmsResponse,
  type PracticeType,
  RESERVED_FIRM_SLUGS,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type InviteResult, InvitesService } from '../auth/invites.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { AdminPrisma } from './admin-prisma.js';
import { FIRM_KEYS, type FirmKeys } from './firm-keys.js';

/**
 * What `firm_applications.data` holds: the review page's groups, as submit (R4 step 2) stores
 * them. The full EIN is never in it, only `business.einLast4`.
 */
const R = FirmApplicationRecord.shape;
export const StoredApplication = z.object({
  business: R.business,
  primaryAdmin: R.primaryAdmin,
  account: R.account,
  credentials: R.credentials,
});
export type StoredApplication = z.infer<typeof StoredApplication>;

type ListQuery = z.output<typeof ListFirmApplicationsQuery>;
type FirmsQuery = z.output<typeof ListFirmsQuery>;

/** "This month" on the counts is the calendar month in US Eastern time. */
const PLATFORM_TIME_ZONE = 'America/New_York';
/** The decided statuses; INFO_REQUESTED is not used in Phase 1 and reads as pending. */
const PENDING = ['PENDING_REVIEW', 'INFO_REQUESTED'] as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const alreadyDecided = () =>
  new ConflictException({
    code: 'APPLICATION_DECIDED',
    message: 'This application is already approved or declined',
  });
const slugTaken = () =>
  new ConflictException({ code: 'SLUG_TAKEN', message: 'This portal address is not available' });
const inviteNotNeeded = () =>
  new ConflictException({
    code: 'INVITE_NOT_NEEDED',
    message: 'There is no activation link to send',
  });

/** The industry pack each practice type gets. TAX_ACCOUNTING is the only pack so far. */
const PACK: Readonly<Record<PracticeType, IndustryPack>> = {
  TAX_ACCOUNTING: 'TAX_ACCOUNTING',
  BOOKKEEPING: 'TAX_ACCOUNTING',
  PAYROLL: 'TAX_ACCOUNTING',
  BUSINESS_CONSULTING: 'TAX_ACCOUNTING',
  OTHER: 'TAX_ACCOUNTING',
};

/**
 * A platform audit event per activation link sent to the owner (on approval or resend). The
 * review page reads them back (`ownerInvite`, OWNER_INVITED history): admin scope reads platform
 * events, but not the firm's invites.
 */
const OWNER_INVITED = 'firm_application.owner_invited';
/** What that event's metadata holds besides ids: the link's expiry. Never the address or token. */
const OwnerInvitedMetadata = z.object({ expiresAt: z.iso.datetime({ offset: true }) });

/**
 * The id of the firm an application creates: a name-based UUID (version 8, SHA-256) of the
 * application's id, the same on every attempt. A repeated approve finds the KMS key it made before
 * (by the firm's alias) and can never make a second firm.
 */
export function firmIdFor(applicationId: string): string {
  const hash = createHash('sha256').update(`firmivra-firm:${applicationId.toLowerCase()}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x80; // version 8
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The owner's link: ACCEPTED once they joined the firm, else EXPIRED after its expiry. */
export function ownerInviteStatus(
  expiresAt: string,
  joinedAt: Date | null,
  now = new Date(),
): 'SENT' | 'EXPIRED' | 'ACCEPTED' {
  if (joinedAt) return 'ACCEPTED';
  return Date.parse(expiresAt) <= now.getTime() ? 'EXPIRED' : 'SENT';
}

/** The first instant of the current calendar month in `timeZone`. */
export function startOfMonthIn(timeZone: string, now = new Date()): Date {
  const part = (type: string, d: Date) =>
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone, [type]: 'numeric', hourCycle: 'h23' })
        .formatToParts(d)
        .find((p) => p.type === type)?.value,
    );
  const guess = new Date(Date.UTC(part('year', now), part('month', now) - 1, 1));
  // How far the zone's wall clock is from UTC at that moment (e.g. -4 h in New York in summer).
  const wall = Date.UTC(
    part('year', guess),
    part('month', guess) - 1,
    part('day', guess),
    part('hour', guess) % 24,
    part('minute', guess),
  );
  return new Date(guess.getTime() - (wall - guess.getTime()));
}

/** The legal name as a portal address: lower case, single hyphens, at most 56 characters. */
export function slugBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 56)
      .replace(/^-+|-+$/g, '') || 'firm'
  );
}

const reviewStatus = (s: FirmApplication['status']): FirmApplicationReviewStatus =>
  s === 'APPROVED' || s === 'DECLINED' ? s : 'PENDING_REVIEW';
const decided = (row: FirmApplication) => row.status === 'APPROVED' || row.status === 'DECLINED';

/**
 * The Super Admin's side of R4: applications with filters and pages, the review page with
 * history and checks, the review actions, approval (the firm, its key and its owner's invite),
 * firms, and the dashboard counts. Admin scope (AdminPrisma), except approval's provisioning.
 */
@Injectable()
export class FirmApplicationsService {
  private readonly logger = new Logger(FirmApplicationsService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    private readonly invites: InvitesService,
    @Inject(FIRM_KEYS) private readonly keys: FirmKeys,
  ) {}

  async list(q: ListQuery): Promise<ListFirmApplicationsResponse> {
    const db = this.admin.db;
    const where: Prisma.FirmApplicationWhereInput = {
      ...(q.status === 'PENDING_REVIEW'
        ? { status: { in: [...PENDING] } }
        : q.status
          ? { status: q.status }
          : {}),
      ...(q.search
        ? {
            OR: (['legalName', 'dbaName', 'contactName', 'contactEmail'] as const).map((f) => ({
              [f]: { contains: q.search, mode: 'insensitive' as const },
            })),
          }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const dir = q.order === 'oldest' ? 'asc' : 'desc';
    const [total, rows] = await Promise.all([
      db.firmApplication.count({ where }),
      db.firmApplication.findMany({
        where,
        orderBy: [{ createdAt: dir }, { id: dir }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => this.listItem(r)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async counts(): Promise<FirmApplicationCounts> {
    const db = this.admin.db;
    const since = startOfMonthIn(PLATFORM_TIME_ZONE);
    const count = (where: Prisma.FirmApplicationWhereInput) => db.firmApplication.count({ where });
    const [all, pendingReview, approved, declined, approvedThisMonth, declinedThisMonth] =
      await Promise.all([
        count({}),
        count({ status: { in: [...PENDING] } }),
        count({ status: 'APPROVED' }),
        count({ status: 'DECLINED' }),
        count({ status: 'APPROVED', reviewedAt: { gte: since } }),
        count({ status: 'DECLINED', reviewedAt: { gte: since } }),
      ]);
    return { all, pendingReview, approved, declined, approvedThisMonth, declinedThisMonth };
  }

  /** The review page. Opening it is audited (it shows the applicant's personal details). */
  async get(id: string): Promise<FirmApplicationRecord> {
    const record = await this.record(id);
    await this.audit.log('firm_application.viewed', { type: 'firm_application', id });
    return record;
  }

  async listFirms(q: FirmsQuery): Promise<ListFirmsResponse> {
    const items = (await this.firmItems())
      .filter(
        (f) =>
          !q.status ||
          (q.status === 'INACTIVE'
            ? f.status === 'SUSPENDED' || f.status === 'CLOSED'
            : f.status === q.status),
      )
      .filter((f) => {
        if (!q.search) return true;
        const term = q.search.toLowerCase();
        return [f.name, f.owner?.name, f.owner?.email].some((v) => v?.toLowerCase().includes(term));
      });
    return {
      items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: items.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async firmCounts(): Promise<FirmCounts> {
    const db = this.admin.db;
    const [active, pendingSetup, inactive, total] = await Promise.all([
      db.business.count({ where: { status: 'ACTIVE' } }),
      db.business.count({ where: { status: 'PENDING_SETUP' } }),
      db.business.count({ where: { status: { in: ['SUSPENDED', 'CLOSED'] } } }),
      db.business.count(),
    ]);
    return { active, pendingSetup, inactive, total };
  }

  async getFirm(id: string): Promise<FirmRecord> {
    const item = (await this.firmItems(id))[0];
    if (!item) throw notFound();
    const application = await this.admin.db.firmApplication.findUnique({
      where: { businessId: id },
      select: { id: true },
    });
    const record = { ...item, application: application ? await this.record(application.id) : null };
    await this.audit.log('business.viewed_by_admin', { type: 'business', id });
    return record;
  }

  async dashboard(): Promise<AdminDashboard> {
    const db = this.admin.db;
    const [pendingApplications, activeFirms] = await Promise.all([
      db.firmApplication.count({ where: { status: { in: [...PENDING] } } }),
      db.business.count({ where: { status: 'ACTIVE' } }),
    ]);
    // Admin scope cannot read members or clients: the user counts wait for R0's platform count.
    return {
      pendingApplications,
      activeFirms,
      totalUsers: null,
      newUsersThisWeek: null,
      monthlyRevenueCents: null,
    };
  }

  // ---------- Review (step 2) ----------

  /**
   * Request Information: the message goes to the applicant by email and the application stays
   * pending (it is the decision_reason, so the database records it in the history). The same
   * message as the last request changes nothing and is not sent again.
   */
  async requestInfo(id: string, message: string): Promise<FirmApplicationRecord> {
    const row = await this.pending(id);
    if (row.decisionReason === message) return this.record(id);
    await this.review(id, { decisionReason: message });
    await this.audit.log('firm_application.info_requested', { type: 'firm_application', id });
    await this.notify.send({
      template: 'firm-application.info-requested',
      to: row.contactEmail,
      businessId: null,
      data: { name: row.contactName, legalName: row.legalName, message },
    });
    return this.record(id);
  }

  /**
   * Decline, with the reason the applicant gets by email. It must differ from the last
   * information request (the database refuses a reused message).
   */
  async decline(id: string, reason: string): Promise<FirmApplicationRecord> {
    const row = await this.pending(id);
    if (row.decisionReason === reason) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Write a reason that differs from the last request',
      });
    }
    await this.review(id, { status: 'DECLINED', decisionReason: reason });
    await this.audit.log('firm_application.declined', { type: 'firm_application', id });
    await this.notify.send({
      template: 'firm-application.declined',
      to: row.contactEmail,
      businessId: null,
      data: { name: row.contactName, legalName: row.legalName, reason },
    });
    return this.record(id);
  }

  /** "Save Note": internal notes, also after a decision. `null` clears them. */
  async saveNotes(id: string, notes: string | null): Promise<FirmApplicationRecord> {
    const { count } = await this.admin.db.firmApplication.updateMany({
      where: { id },
      data: { internalNotes: notes },
    });
    if (count === 0) throw notFound();
    await this.audit.log('firm_application.notes_saved', { type: 'firm_application', id });
    return this.record(id);
  }

  // ---------- Approve (step 3) ----------

  /**
   * Approve: the firm (PENDING_SETUP, named after the legal name) at `slug`, else the suggested
   * address, with its own KMS key, linked to the application; then the primary administrator is
   * invited as its owner (R2's invite sends the activation email).
   * An approved application without its firm (a failure part way) picks up where it stopped: each
   * step is safe to repeat. Once linked it is final; a missing owner link is sent with
   * resendOwnerInvite.
   */
  async approve(id: string, slug: string | undefined): Promise<FirmApplicationRecord> {
    const db = this.admin.db;
    const row = await db.firmApplication.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (row.status === 'DECLINED' || row.businessId) throw alreadyDecided();
    const d = this.stored(row);
    const chosen = slug ?? (await this.suggest(row));
    if (await db.business.findUnique({ where: { slug: chosen }, select: { id: true } })) {
      throw slugTaken();
    }
    // Admin scope: the database records the acting admin and the history.
    if (row.status !== 'APPROVED') await this.review(id, { status: 'APPROVED' });
    const businessId = await this.provision(row, d, chosen);
    await this.audit.log(
      'firm_application.approved',
      { type: 'firm_application', id },
      { businessId },
    );
    const invite = await this.invites.createInvite({
      businessId,
      email: row.contactEmail,
      name: row.contactName,
      role: 'OWNER',
      invitedBy: null,
    });
    await this.ownerInvited(id, businessId, invite, false);
    return this.record(id);
  }

  /**
   * "Resend activation link": a new link for the owner of the firm an approval created (the old
   * one stops working), or the first one if approve stopped before sending it. 409
   * INVITE_NOT_NEEDED before approval, for a suspended or closed firm, or once the owner joined.
   */
  async resendOwnerInvite(id: string): Promise<FirmApplicationRecord> {
    const db = this.admin.db;
    const row = await db.firmApplication.findUnique({ where: { id } });
    if (!row) throw notFound();
    const firm =
      row.status === 'APPROVED' && row.businessId
        ? await db.business.findUnique({
            where: { id: row.businessId },
            select: { id: true, status: true },
          })
        : null;
    // The owner of a suspended or closed firm could not use a link (InvitesService refuses both).
    if (firm?.status !== 'PENDING_SETUP' && firm?.status !== 'ACTIVE') throw inviteNotNeeded();
    const owner = await this.owner(firm.id);
    if (owner?.joinedAt) throw inviteNotNeeded();
    const invite =
      owner?.status === 'INVITED'
        ? await this.invites.resendInvite({
            businessId: firm.id,
            membershipId: owner.id,
            invitedBy: null,
          })
        : await this.invites.createInvite({
            businessId: firm.id,
            email: row.contactEmail,
            name: row.contactName,
            role: 'OWNER',
            invitedBy: null,
          });
    await this.ownerInvited(id, firm.id, invite, true);
    return this.record(id);
  }

  /**
   * The firm, with the KMS key made first, and the link from the application, in one transaction
   * in platform scope. The firm's id comes from the application's (firmIdFor), so a repeat finds
   * the same key, and a second approve at the same time cannot make a second firm.
   */
  private async provision(
    row: FirmApplication,
    d: StoredApplication,
    slug: string,
  ): Promise<string> {
    const businessId = firmIdFor(row.id);
    const kmsKeyId = await this.keys.ensureKey(businessId);
    try {
      await this.admin.provision(async (tx) => {
        await tx.business.create({
          data: {
            id: businessId,
            name: row.legalName,
            legalName: row.legalName,
            slug,
            status: 'PENDING_SETUP',
            pack: PACK[d.business.practiceType],
            businessType: d.business.practiceType,
            kmsKeyId,
          },
        });
        const linked = await tx.firmApplication.updateMany({
          where: { id: row.id, status: 'APPROVED', businessId: null },
          data: { businessId },
        });
        if (linked.count !== 1) throw alreadyDecided();
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      // The firm's id or the address was taken meanwhile: by another approve of this application,
      // or by another firm.
      const made = await this.admin.db.business.findUnique({
        where: { id: businessId },
        select: { id: true },
      });
      throw made ? alreadyDecided() : slugTaken();
    }
    return businessId;
  }

  /** Records a link sent to the owner as a platform event: ids and the link's expiry only. */
  private async ownerInvited(
    id: string,
    businessId: string,
    invite: InviteResult,
    resent: boolean,
  ): Promise<void> {
    await this.audit.log(
      OWNER_INVITED,
      { type: 'firm_application', id },
      {
        businessId,
        membershipId: invite.membershipId,
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
        resent,
      },
    );
  }

  /** The firm's first owner: the primary administrator approval invited (admin scope reads owners). */
  private owner(businessId: string) {
    return this.admin.db.membership.findFirst({
      where: { businessId, role: 'OWNER' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true, joinedAt: true },
    });
  }

  /** The application, if it can still be reviewed: 404, then 409 APPLICATION_DECIDED. */
  private async pending(id: string): Promise<FirmApplication> {
    const row = await this.admin.db.firmApplication.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (decided(row) || row.businessId) throw alreadyDecided();
    return row;
  }

  /**
   * One review update, as the signed-in admin, only while the application is pending; a decision
   * someone else made in between is 409 (the database also refuses a change to a decided one).
   */
  private async review(id: string, data: Prisma.FirmApplicationUpdateManyMutationInput) {
    const { count } = await this.admin.db.firmApplication.updateMany({
      where: { id, status: { in: [...PENDING] }, businessId: null },
      data: { ...data, reviewedByUserId: this.admin.adminUserId, reviewedAt: new Date() },
    });
    if (count === 0) throw alreadyDecided();
  }

  // ---------- Mapping ----------

  /** The stored form, or a clear error for a row written before the stored shape existed. */
  private stored(row: FirmApplication): StoredApplication {
    const parsed = StoredApplication.safeParse(row.data);
    if (!parsed.success) {
      this.logger.error(`Firm application ${row.id}: data is not in the stored shape`);
      throw new Error(`Firm application ${row.id} has data in an old shape`);
    }
    return parsed.data;
  }

  private listItem(row: FirmApplication): FirmApplicationListItem {
    const d = this.stored(row);
    return {
      id: row.id,
      status: reviewStatus(row.status),
      legalName: row.legalName,
      dbaName: row.dbaName,
      practiceType: d.business.practiceType,
      entityType: d.business.entityType,
      services: d.business.services,
      requestedPlan: d.account.requestedPlan,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone ?? d.primaryAdmin.phone,
      submittedAt: row.createdAt.toISOString(),
      decidedAt: decided(row) && row.reviewedAt ? row.reviewedAt.toISOString() : null,
    };
  }

  private async record(id: string): Promise<FirmApplicationRecord> {
    const db = this.admin.db;
    const row = await db.firmApplication.findUnique({ where: { id } });
    if (!row) throw notFound();
    const d = this.stored(row);
    const [history, firm, links, owner] = await Promise.all([
      db.firmApplicationStatusHistory.findMany({
        where: { applicationId: id },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      }),
      row.businessId
        ? db.business.findUnique({
            where: { id: row.businessId },
            select: { id: true, slug: true, name: true, status: true },
          })
        : Promise.resolve(null),
      // The owner's activation links, newest first.
      db.auditLog.findMany({
        where: {
          businessId: null,
          action: OWNER_INVITED,
          entityType: 'firm_application',
          entityId: id,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { actorUserId: true, createdAt: true, metadata: true },
      }),
      row.businessId ? this.owner(row.businessId) : Promise.resolve(null),
    ]);
    const admins = await this.adminRefs([
      row.reviewedByUserId,
      ...history.map((h) => h.changedByUserId),
      ...links.map((l) => l.actorUserId),
    ]);
    const by = (userId: string | null) => (userId ? (admins.get(userId) ?? null) : null);
    const lastLink = links[0] && OwnerInvitedMetadata.safeParse(links[0].metadata).data;
    const events: FirmApplicationEvent[] = [
      ...links.map((l): FirmApplicationEvent => ({
        type: 'OWNER_INVITED',
        at: l.createdAt.toISOString(),
        by: by(l.actorUserId),
        message: null,
      })),
      ...history.flatMap((h): FirmApplicationEvent[] => {
        const at = h.changedAt.toISOString();
        if (h.fromStatus === null) return [{ type: 'SUBMITTED', at, by: null, message: null }];
        if (h.toStatus === 'APPROVED')
          return [{ type: 'APPROVED', at, by: by(h.changedByUserId), message: null }];
        if (h.toStatus === 'DECLINED') {
          return [{ type: 'DECLINED', at, by: by(h.changedByUserId), message: h.reason }];
        }
        // A request for information: a new message on a pending application.
        if (h.reason) {
          return [{ type: 'INFO_REQUESTED', at, by: by(h.changedByUserId), message: h.reason }];
        }
        return [];
      }),
    ];
    return {
      id: row.id,
      status: reviewStatus(row.status),
      submittedAt: row.createdAt.toISOString(),
      business: d.business,
      primaryAdmin: d.primaryAdmin,
      account: d.account,
      credentials: d.credentials,
      documents: [],
      checks: await this.checks(row, d),
      internalNotes: row.internalNotes,
      decision:
        decided(row) && row.reviewedAt
          ? {
              by: by(row.reviewedByUserId),
              at: row.reviewedAt.toISOString(),
              // An approval keeps the last request's message in decision_reason: not a reason.
              reason: row.status === 'DECLINED' ? row.decisionReason : null,
            }
          : null,
      // Also while approved without its firm: approving again uses it.
      suggestedSlug: row.status !== 'DECLINED' && !row.businessId ? await this.suggest(row) : null,
      firm: firm as BusinessSummary | null,
      ownerInvite: lastLink
        ? {
            status: ownerInviteStatus(lastLink.expiresAt, owner?.joinedAt ?? null),
            expiresAt: lastLink.expiresAt,
          }
        : null,
      // Newest first. Sorting keeps the order of equal times: a link before the approval that sent it.
      history: events.sort((a, b) => b.at.localeCompare(a.at)),
    };
  }

  /**
   * Names for the Super Admins in a decision or the history. Admin scope reads only the signed-in
   * admin's own user row; another admin shows as "Firmivra admin" until R0 lets admins read
   * each other's names.
   */
  private async adminRefs(ids: (string | null)[]): Promise<Map<string, AdminRef>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    const users = wanted.length
      ? await this.admin.db.user.findMany({
          where: { id: { in: wanted } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return new Map(
      wanted.map((userId) => [userId, { userId, name: names.get(userId) ?? 'Firmivra admin' }]),
    );
  }

  private async checks(
    row: FirmApplication,
    d: StoredApplication,
  ): Promise<FirmApplicationCheck[]> {
    const db = this.admin.db;
    const same = (value: string) => ({ equals: value, mode: 'insensitive' as const });
    const label = (r: { legalName: string; status: FirmApplication['status'] }) =>
      `${r.legalName} (${reviewStatus(r.status).toLowerCase().replace('_', ' ')})`;
    const [sameNameApp, sameNameFirm, sameEmail] = await Promise.all([
      db.firmApplication.findFirst({
        where: { id: { not: row.id }, legalName: same(row.legalName) },
        select: { legalName: true, status: true },
      }),
      db.business.findFirst({
        where: {
          ...(row.businessId ? { id: { not: row.businessId } } : {}),
          OR: [{ legalName: same(row.legalName) }, { name: same(row.legalName) }],
        },
        select: { name: true },
      }),
      db.firmApplication.findFirst({
        where: { id: { not: row.id }, contactEmail: same(row.contactEmail) },
        select: { legalName: true, status: true },
      }),
    ]);
    const host = d.business.website
      ? new URL(d.business.website).hostname.replace(/^www\./, '')
      : null;
    const domain = row.contactEmail.split('@')[1]?.toLowerCase();
    return [
      // The keyed EIN hash arrives with R0's ein columns (step 2).
      { key: 'DUPLICATE_EIN', result: 'SKIPPED', note: 'The EIN check comes with the EIN fields' },
      sameNameApp
        ? { key: 'DUPLICATE_NAME', result: 'WARN', note: `Same name as ${label(sameNameApp)}` }
        : sameNameFirm
          ? {
              key: 'DUPLICATE_NAME',
              result: 'WARN',
              note: `Same name as the firm ${sameNameFirm.name}`,
            }
          : {
              key: 'DUPLICATE_NAME',
              result: 'PASS',
              note: 'No other application or firm has this name',
            },
      sameEmail
        ? { key: 'DUPLICATE_EMAIL', result: 'WARN', note: `Same email as ${label(sameEmail)}` }
        : { key: 'DUPLICATE_EMAIL', result: 'PASS', note: 'No other application uses this email' },
      !host
        ? { key: 'EMAIL_DOMAIN', result: 'SKIPPED', note: 'No website given' }
        : host === domain || host.endsWith(`.${domain ?? ''}`)
          ? { key: 'EMAIL_DOMAIN', result: 'PASS', note: 'The email domain matches the website' }
          : {
              key: 'EMAIL_DOMAIN',
              result: 'WARN',
              note: "The email domain doesn't match the website",
            },
    ];
  }

  /** The free portal address approve would use: the legal name, then -2, -3... */
  private async suggest(row: FirmApplication): Promise<string> {
    const base = slugBase(row.legalName);
    const taken = new Set(
      (
        await this.admin.db.business.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((b) => b.slug),
    );
    const free = (slug: string) => !taken.has(slug) && !RESERVED_FIRM_SLUGS.includes(slug);
    let slug = base;
    for (let i = 2; !free(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  /**
   * Every firm as a list row (or just one). The owner is the active owner's contact, or before
   * activation the application's primary administrator.
   */
  private async firmItems(onlyId?: string): Promise<FirmListItem[]> {
    const db = this.admin.db;
    const where = onlyId ? { id: onlyId } : {};
    const [firms, owners, applications] = await Promise.all([
      db.business.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, slug: true, name: true, status: true, createdAt: true },
      }),
      db.membership.findMany({
        where: { role: 'OWNER', status: 'ACTIVE', ...(onlyId ? { businessId: onlyId } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { businessId: true, userId: true },
      }),
      db.firmApplication.findMany({
        where: { businessId: onlyId ?? { not: null } },
      }),
    ]);
    const users = new Map(
      (
        await db.user.findMany({
          where: { id: { in: owners.map((o) => o.userId) } },
          select: { id: true, name: true, email: true, phone: true },
        })
      ).map((u) => [u.id, u]),
    );
    const ownerOf = new Map<string, FirmListItem['owner']>();
    for (const o of owners) {
      const u = users.get(o.userId);
      if (u && !ownerOf.has(o.businessId)) {
        ownerOf.set(o.businessId, { name: u.name, email: u.email, phone: u.phone });
      }
    }
    const applicationOf = new Map(applications.map((a) => [a.businessId, a]));
    return firms.map((f) => {
      const a = applicationOf.get(f.id);
      // Only the owner fallback and the plan come from it, so an older form shape just leaves them out.
      const d = a ? (StoredApplication.safeParse(a.data).data ?? null) : null;
      return {
        id: f.id,
        slug: f.slug,
        name: f.name,
        status: f.status,
        owner:
          ownerOf.get(f.id) ??
          (d
            ? {
                name: d.primaryAdmin.fullName,
                email: d.primaryAdmin.email,
                phone: d.primaryAdmin.phone,
              }
            : null),
        plan: d?.account.requestedPlan ?? null,
        approvedAt: a?.reviewedAt && a.status === 'APPROVED' ? a.reviewedAt.toISOString() : null,
        createdAt: f.createdAt.toISOString(),
      };
    });
  }
}
