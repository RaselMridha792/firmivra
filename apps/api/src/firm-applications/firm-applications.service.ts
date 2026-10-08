import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Database, FirmApplication, Prisma, TxClient } from '@firmivra/db';
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
  ListFirmApplicationsQuery,
  type ListFirmApplicationsResponse,
  ListFirmsQuery,
  type ListFirmsResponse,
  RESERVED_FIRM_SLUGS,
  websiteHost,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  NOTIFY_SERVICE,
  type NotifyMessage,
  type NotifyService,
  type NotifyTemplate,
} from '../notify/notify.types.js';
import { AdminPrisma } from './admin-prisma.js';

/**
 * What `firm_applications.data` holds: the review page's groups, as submit (R4 step 2) stores
 * them, without any part of the EIN. R0's #80 refuses a key starting with "ein" anywhere in it
 * (any case); the last 4 digits get their own column, `ein_last4`. An older row's
 * `business.einLast4` is dropped when read, and nothing reads it. The database doesn't check the
 * rest, so a row in another shape (written before this one, or edited by hand) is shown from the
 * table's own columns instead (`formReadable` false).
 */
const R = FirmApplicationRecord.shape;
export const StoredApplication = z.object({
  business: R.business.unwrap().omit({ einLast4: true }),
  primaryAdmin: R.primaryAdmin.unwrap(),
  account: R.account.unwrap(),
  credentials: R.credentials,
});
export type StoredApplication = z.infer<typeof StoredApplication>;

/** The firms' addresses starting with a base, read in admin or platform scope. */
type SlugQuery = { where: { slug: { startsWith: string } }; select: { slug: true } };
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
  new ConflictException({ code: 'SLUG_TAKEN', message: 'Another firm has this portal address' });

/**
 * Whether the owner invite (step 3) would take this name: R0's `invites_name` rule, something
 * besides spaces, at most 120 characters (code points, as char_length counts) and no control
 * characters. Submit has kept the primary administrator's name to it since #107; older rows could
 * hold up to 200 characters.
 */
export function ownerNameOk(name: string): boolean {
  return name.trim() !== '' && [...name].length <= 120 && !/\p{Cc}/u.test(name);
}
const ownerNameTooLong = () =>
  new ConflictException({
    code: 'OWNER_NAME_TOO_LONG',
    message:
      "The primary administrator's name is too long for the owner invite (over 120 characters)",
  });

/**
 * Firmivra support: the applicant answers an information request by replying to its email. It
 * must stay the same as `supportEmail` in apps/web/src/lib/company.ts (apps/api cannot import
 * apps/web).
 */
const FIRMIVRA_SUPPORT_EMAIL = 'admin@firmivra.com';

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

/**
 * LIKE wildcards in a search term or a compared name are plain characters: Prisma's insensitive
 * `contains` and `equals` are ILIKE on PostgreSQL, and it doesn't escape them.
 */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
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

/** Free email services: an administrator's address there says nothing about the firm. */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
];

/**
 * The EMAIL_DOMAIN check: a free email address is a WARN whatever the website. Otherwise the
 * email's domain is compared with the website's, which is SKIPPED when there is no website or it
 * isn't a valid address.
 */
export function emailDomainCheck(email: string, website: string | null): FirmApplicationCheck {
  const check = (result: FirmApplicationCheck['result'], note: string): FirmApplicationCheck => ({
    key: 'EMAIL_DOMAIN',
    result,
    note,
  });
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (FREE_MAIL_DOMAINS.includes(domain)) return check('WARN', 'A free email address');
  const site = website?.trim();
  if (!site) return check('SKIPPED', 'No website to compare with');
  // As the contract's Website field reads it: `example.com` is `https://example.com`, and `N/A`
  // or `ftp://example.com` has no domain name for a host.
  const host = websiteHost(site)?.replace(/^www\./, '');
  if (!host) return check('SKIPPED', "The website isn't a valid address");
  return domain && (host === domain || host.endsWith(`.${domain}`))
    ? check('PASS', 'The email domain matches the website')
    : check('WARN', "The email domain doesn't match the website");
}

const reviewStatus = (s: FirmApplication['status']): FirmApplicationReviewStatus =>
  s === 'APPROVED' || s === 'DECLINED' ? s : 'PENDING_REVIEW';
const decided = (row: FirmApplication) => row.status === 'APPROVED' || row.status === 'DECLINED';

/**
 * The Super Admin's read side of R4 (T05): applications with filters and pages, the review page
 * with history and checks, firms, and the dashboard counts. Admin scope only (AdminPrisma).
 */
@Injectable()
export class FirmApplicationsService {
  private readonly logger = new Logger(FirmApplicationsService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  async list(q: ListQuery): Promise<ListFirmApplicationsResponse> {
    const db = this.admin.db;
    const term = q.search ? likeEscape(q.search) : undefined;
    const where: Prisma.FirmApplicationWhereInput = {
      ...(q.status === 'PENDING_REVIEW'
        ? { status: { in: [...PENDING] } }
        : q.status
          ? { status: q.status }
          : {}),
      ...(term
        ? {
            OR: (['legalName', 'dbaName', 'contactName', 'contactEmail'] as const).map((f) => ({
              [f]: { contains: term, mode: 'insensitive' as const },
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
   * Request Information: the message goes to the applicant by email, with replies to Firmivra
   * support, and the application stays pending (it is the decision_reason, so the database
   * records it in the history). The request and its audit row land together, and the email goes
   * only after they have. The same message as the last request changes nothing and sends
   * nothing; a request that failed changed nothing, so trying it again sends it.
   */
  async requestInfo(id: string, message: string): Promise<FirmApplicationRecord> {
    const asked = await this.admin.transaction(async (tx) => {
      const row = await this.pending(tx, id);
      if (row.decisionReason === message) return null;
      await this.review(tx, id, { decisionReason: message });
      // In admin scope the database takes it only with the acting admin as the actor (#52).
      await this.audit.logIn(tx, 'firm_application.info_requested', {
        type: 'firm_application',
        id,
      });
      return row;
    });
    if (asked) {
      await this.emailApplicant(id, {
        template: 'firm-application.info-requested',
        to: asked.contactEmail,
        businessId: null,
        replyTo: FIRMIVRA_SUPPORT_EMAIL,
        data: { name: asked.contactName, legalName: asked.legalName, message },
      });
    }
    return this.record(id);
  }

  /**
   * Decline, with the reason the applicant gets by email. It must differ from the last
   * information request (the database refuses a reused message). The decision and its audit row
   * land together, and the email goes only after they have.
   */
  async decline(id: string, reason: string): Promise<FirmApplicationRecord> {
    const declined = await this.admin.transaction(async (tx) => {
      const row = await this.pending(tx, id);
      if (row.decisionReason === reason) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Write a reason that differs from the last request',
        });
      }
      await this.review(tx, id, { status: 'DECLINED', decisionReason: reason });
      // In admin scope the database takes it only with the acting admin as the actor (#52).
      await this.audit.logIn(tx, 'firm_application.declined', { type: 'firm_application', id });
      return row;
    });
    await this.emailApplicant(id, {
      template: 'firm-application.declined',
      to: declined.contactEmail,
      businessId: null,
      data: { name: declined.contactName, legalName: declined.legalName, reason },
    });
    return this.record(id);
  }

  /**
   * Approve: the decision, then the firm (PENDING_SETUP, named after the legal name) at `slug`, or
   * else the free address the review page suggests. Two transactions, because the database takes
   * each half only in its own scope: the decision in admin scope (recorded as the acting admin,
   * with its audit row), then the firm in platform scope (businesses are created only there, and
   * once the application links a firm, admin scope can no longer change it).
   *
   * If the second half fails (an address taken in between: 409 SLUG_TAKEN), the application is
   * approved without a firm. Approving it again finishes the job, with the same or another
   * address; the review page offers it (`suggestedSlug` stays set until a firm is linked).
   * 409 OWNER_NAME_TOO_LONG and a taken `slug` are checked before the decision.
   */
  async approve(id: string, slug?: string): Promise<FirmApplicationRecord> {
    await this.admin.transaction(async (tx) => {
      await this.lock(tx, id);
      const row = await tx.firmApplication.findUnique({ where: { id } });
      if (!row) throw notFound();
      if (row.status === 'DECLINED' || row.businessId) throw alreadyDecided();
      if (!ownerNameOk(row.contactName)) throw ownerNameTooLong();
      if (slug && (await tx.business.findUnique({ where: { slug }, select: { id: true } }))) {
        throw slugTaken();
      }
      if (row.status === 'APPROVED') return;
      await this.review(tx, id, { status: 'APPROVED' });
      // In admin scope the database takes it only with the acting admin as the actor (#52).
      await this.audit.logIn(tx, 'firm_application.approved', { type: 'firm_application', id });
    });
    await this.createFirm(id, slug);
    return this.record(id);
  }

  /**
   * The approved application's firm, in platform scope, linked to the application in the same
   * transaction. Nothing happens if a firm is already linked (two approvals at once: the second
   * waits on the row lock, then finds it). With no picked address, one taken in between moves on
   * to the next free one, so only a picked address can be SLUG_TAKEN here. `business.created` is a
   * platform event by the acting admin.
   */
  private async createFirm(id: string, slug: string | undefined): Promise<void> {
    // Platform scope only for a Super Admin request (throws otherwise, like AdminPrisma's db).
    void this.admin.adminUserId;
    await this.database.withScope({ kind: 'platform' }, async (tx) => {
      await this.lock(tx, id);
      const row = await tx.firmApplication.findUnique({ where: { id } });
      if (!row || row.status !== 'APPROVED') throw notFound();
      if (row.businessId) return;
      const d = this.stored(row);
      const taken = new Set<string>();
      let firmId: string | undefined;
      while (!firmId) {
        const next = slug ?? (await this.freeSlug(tx, row.legalName, taken));
        // ON CONFLICT DO NOTHING: a taken address returns no row and leaves the transaction usable.
        const [created] = await tx.business.createManyAndReturn({
          data: [
            {
              name: row.legalName,
              legalName: row.legalName,
              slug: next,
              businessType: d?.business.practiceType ?? null,
              // The only pack (#52's IndustryPack), whatever the practice type.
              pack: 'TAX_ACCOUNTING',
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        if (created) firmId = created.id;
        else if (slug) throw slugTaken();
        else taken.add(next);
      }
      await tx.firmApplication.update({ where: { id }, data: { businessId: firmId } });
      await this.audit.logIn(
        tx,
        'business.created',
        { type: 'business', id: firmId },
        { applicationId: id },
      );
    });
  }

  /**
   * "Save Note": internal notes, also after a decision. `null` clears them. The notes and their
   * audit row land together.
   */
  async saveNotes(id: string, notes: string | null): Promise<FirmApplicationRecord> {
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.firmApplication.updateMany({
        where: { id },
        data: { internalNotes: notes },
      });
      if (count === 0) throw notFound();
      await this.audit.logIn(tx, 'firm_application.notes_saved', { type: 'firm_application', id });
    });
    return this.record(id);
  }

  /**
   * The application, if it can still be reviewed: 404, then 409 APPLICATION_DECIDED. Its row is
   * locked first (the lock the update takes), so a second review at the same time, such as a
   * double click, waits for this one and then reads its result: the same message is then no
   * change, and after a decision it is 409.
   */
  private async pending(tx: TxClient, id: string): Promise<FirmApplication> {
    await this.lock(tx, id);
    const row = await tx.firmApplication.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (decided(row) || row.businessId) throw alreadyDecided();
    return row;
  }

  /** Locks the application's row for this transaction (the lock an update takes). */
  private async lock(tx: TxClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM firm_applications WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  }

  /**
   * One review update, as the signed-in admin, only while the application is pending (`pending`
   * locked its row; the database also refuses a change to a decided one).
   */
  private async review(
    tx: TxClient,
    id: string,
    data: Prisma.FirmApplicationUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await tx.firmApplication.updateMany({
      where: { id, status: { in: [...PENDING] }, businessId: null },
      data: { ...data, reviewedByUserId: this.admin.adminUserId, reviewedAt: new Date() },
    });
    if (count === 0) throw alreadyDecided();
  }

  /**
   * Emails the applicant about a review that has committed. A failed send changes nothing: the
   * review stands and the request still succeeds. The warning holds the application's id only,
   * never the address or the message (hard rule 4).
   */
  private async emailApplicant<T extends NotifyTemplate>(
    id: string,
    message: NotifyMessage<T>,
  ): Promise<void> {
    try {
      await this.notify.send(message);
    } catch {
      this.logger.warn(`Firm application ${id}: the ${message.template} email could not be sent`);
    }
  }

  // ---------- Mapping ----------

  /**
   * The stored form, or null when the row's data is not in the stored shape: the row is then
   * shown from the table's own columns. Never throws, so one such row can't break a page.
   */
  private stored(row: FirmApplication): StoredApplication | null {
    const parsed = StoredApplication.safeParse(row.data);
    if (parsed.success) return parsed.data;
    // The id only: the data holds the applicant's personal details.
    this.logger.warn(`Firm application ${row.id}: the stored form could not be read`);
    return null;
  }

  private listItem(row: FirmApplication): FirmApplicationListItem {
    const d = this.stored(row);
    return {
      id: row.id,
      status: reviewStatus(row.status),
      legalName: row.legalName,
      dbaName: row.dbaName,
      formReadable: d !== null,
      practiceType: d?.business.practiceType ?? null,
      entityType: d?.business.entityType ?? null,
      services: d?.business.services ?? [],
      requestedPlan: d?.account.requestedPlan ?? null,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone ?? d?.primaryAdmin.phone ?? null,
      submittedAt: row.createdAt.toISOString(),
      decidedAt: decided(row) && row.reviewedAt ? row.reviewedAt.toISOString() : null,
    };
  }

  private async record(id: string): Promise<FirmApplicationRecord> {
    const db = this.admin.db;
    const row = await db.firmApplication.findUnique({ where: { id } });
    if (!row) throw notFound();
    const d = this.stored(row);
    const [history, firm] = await Promise.all([
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
    ]);
    const admins = await this.adminRefs([
      row.reviewedByUserId,
      ...history.map((h) => h.changedByUserId),
    ]);
    const by = (userId: string | null) => (userId ? (admins.get(userId) ?? null) : null);
    return {
      id: row.id,
      status: reviewStatus(row.status),
      submittedAt: row.createdAt.toISOString(),
      legalName: row.legalName,
      dbaName: row.dbaName,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      formReadable: d !== null,
      // The EIN's last 4 come only from their own column, never from the stored form.
      business: d ? { ...d.business, einLast4: row.einLast4 } : null,
      primaryAdmin: d?.primaryAdmin ?? null,
      account: d?.account ?? null,
      credentials: d?.credentials ?? [],
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
      // Also for an approved application whose firm is not created yet: approving again uses it.
      suggestedSlug:
        row.status !== 'DECLINED' && !row.businessId
          ? await this.freeSlug(db, row.legalName)
          : null,
      firm: firm as BusinessSummary | null,
      // The owner's invite and its expiry are recorded by approve (step 3).
      ownerInvite: null,
      history: history.flatMap((h): FirmApplicationEvent[] => {
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

  /** Run from the table's columns, so they work when the stored form can't be read (`d` null). */
  private async checks(
    row: FirmApplication,
    d: StoredApplication | null,
  ): Promise<FirmApplicationCheck[]> {
    const db = this.admin.db;
    // Insensitive equals is ILIKE too: a `_` in a name or email matches only a `_`.
    const same = (value: string) => ({ equals: likeEscape(value), mode: 'insensitive' as const });
    const label = (r: { legalName: string; status: FirmApplication['status'] }) =>
      `${r.legalName} (${reviewStatus(r.status).toLowerCase().replace('_', ' ')})`;
    const [sameEin, sameNameApp, sameNameFirm, sameEmail] = await Promise.all([
      // The keyed hash (submit writes it with the last 4): firms keep their EIN encrypted with
      // their own key, so only applications compare.
      row.einHash
        ? db.firmApplication.findFirst({
            where: { id: { not: row.id }, einHash: { equals: row.einHash } },
            orderBy: { createdAt: 'asc' },
            select: { legalName: true, status: true },
          })
        : Promise.resolve(null),
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
    return [
      !row.einHash
        ? { key: 'DUPLICATE_EIN', result: 'SKIPPED', note: 'No EIN given' }
        : sameEin
          ? { key: 'DUPLICATE_EIN', result: 'WARN', note: `Same EIN as ${label(sameEin)}` }
          : { key: 'DUPLICATE_EIN', result: 'PASS', note: 'No other application has this EIN' },
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
      emailDomainCheck(row.contactEmail, d?.business.website ?? null),
    ];
  }

  /**
   * The free portal address approve would use: the legal name, then -2, -3... `alsoTaken` adds
   * addresses found taken since the firms were read.
   */
  private async freeSlug(
    db: { business: { findMany(args: SlugQuery): Promise<{ slug: string }[]> } },
    legalName: string,
    alsoTaken: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    const base = slugBase(legalName);
    const firms = await db.business.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set([...alsoTaken, ...firms.map((f) => f.slug)]);
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
      // Only the owner fallback and the plan come from it; an unreadable form leaves them out.
      const d = a ? this.stored(a) : null;
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
