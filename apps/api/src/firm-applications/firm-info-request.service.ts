import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FIRMIVRA_REQUEST_PREFIX,
  type RequestFirmInformationRequest,
  type SupportTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { SupportTicketsService } from '../admin-support/support-tickets.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { AdminPrisma } from './admin-prisma.js';

type Body = z.output<typeof RequestFirmInformationRequest>;

/** The audit action the firm's Account History reads (SA-FRM-F06). */
export const FIRM_INFO_REQUESTED = 'business.info_requested';

const PLATFORM_TIME_ZONE = 'America/New_York';
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const cannotAnswer = () =>
  new ConflictException({
    code: 'FIRM_CANNOT_ANSWER',
    message: 'Only an active firm with an active owner can be asked for information',
  });

/** Today's date in US Eastern time, as YYYY-MM-DD. */
const easternToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PLATFORM_TIME_ZONE }).format(new Date());

/** "December 1, 2026": a calendar date, no zone. */
const longDate = (day: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

/**
 * Request Information on a firm's page (SA-FRM-F06, Y09): Firmivra asks the firm's owner for
 * information through a Support ticket, so the message, the owner's answer and its files live in
 * that ticket. The ticket is made by Support's own create (its permissions, numbering, SLA and
 * history), Waiting on Customer, source Internal, assigned to the asking Super Admin when they
 * take tickets (else the queue). The firm's Account History gets an entry linking it, and the
 * owner an email; the owner answers in Settings > Requests from Firmivra.
 */
@Injectable()
export class FirmInfoRequestService {
  private readonly logger = new Logger(FirmInfoRequestService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly support: SupportTicketsService,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_BASE_URL'>,
  ) {}

  /** Whether the firm can be asked: Active, with an active owner to answer. */
  async canAsk(firmId: string, status: string): Promise<boolean> {
    if (status !== 'ACTIVE') return false;
    return (await this.ownerOf(firmId)) !== null;
  }

  async request(firmId: string, body: Body): Promise<void> {
    const db = this.admin.db;
    const firm = await db.business.findUnique({
      where: { id: firmId },
      select: { id: true, name: true, status: true },
    });
    if (!firm) throw notFound();
    const owner = await this.ownerOf(firmId);
    if (firm.status !== 'ACTIVE' || !owner) throw cannotAnswer();
    if (body.replyBy && body.replyBy < easternToday()) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid',
        details: [{ path: 'replyBy', message: 'Choose today or a later day' }],
      });
    }
    const [categories, priorities] = await Promise.all([
      db.supportCategory.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true },
      }),
      db.supportPriority.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, code: true },
      }),
    ]);
    // Support Settings' own "Information request" category when the team made one.
    const category =
      categories.find((c) => /^information requests?$/i.test(c.name.trim())) ??
      categories.find((c) => c.name === 'General Inquiry') ??
      categories[0];
    const priority = priorities.find((p) => p.code === 'MEDIUM') ?? priorities.at(-1);
    if (!category || !priority) {
      throw new ServiceUnavailableException({
        code: 'SUPPORT_UNAVAILABLE',
        message: 'Support has no active category or priority to file this under',
      });
    }
    const description = body.replyBy
      ? `${body.message}\n\nPlease answer by ${longDate(body.replyBy)}.`
      : body.message;
    const create = (assignTo: string) =>
      this.support.create({
        requestId: body.requestId,
        firmId,
        contactId: owner.userId,
        subject: `${FIRMIVRA_REQUEST_PREFIX}${body.subject}`,
        categoryId: category.id,
        priorityId: priority.id,
        assignTo,
        status: 'WAITING_ON_CUSTOMER',
        source: 'INTERNAL',
        description,
        uploadTokens: [],
        internalNote: '',
        notifyAssignee: false,
      });
    let ticket: SupportTicket;
    try {
      ticket = await create(this.admin.adminUserId);
    } catch (error) {
      // A Super Admin who takes no tickets: the request waits in the queue instead.
      if (!(error instanceof HttpException) || codeOf(error) !== 'AGENT_INACTIVE') throw error;
      ticket = await create('QUEUE');
    }
    // The same request id used for another ticket (another firm, or not a request): refused.
    if (ticket.firm.id !== firmId || !ticket.subject.startsWith(FIRMIVRA_REQUEST_PREFIX)) {
      throw new ConflictException({
        code: 'DUPLICATE_REQUEST',
        message: 'This request id was already used for something else',
      });
    }
    // A retry of the same request answers it again, without a second entry or email.
    const logged = await db.auditLog.findFirst({
      where: {
        businessId: null,
        entityType: 'business',
        entityId: firmId,
        action: FIRM_INFO_REQUESTED,
        metadata: { path: ['ticketId'], equals: ticket.id },
      },
      select: { id: true },
    });
    if (logged) return;
    await this.audit.log(
      FIRM_INFO_REQUESTED,
      { type: 'business', id: firmId },
      {
        ticketId: ticket.id,
        number: ticket.number,
        subject: body.subject,
        replyBy: body.replyBy ?? null,
      },
      { businessId: null },
    );
    try {
      await this.notify.send({
        template: 'platform.firm-info-request',
        to: owner.email,
        businessId: null,
        recipient: { userId: owner.userId },
        data: {
          name: owner.name,
          firmName: firm.name,
          reference: `#${ticket.number}`,
          subject: body.subject,
          message: body.message,
          replyBy: body.replyBy ?? null,
          link: new URL(`/settings/firmivra-requests/${ticket.id}`, this.env.APP_BASE_URL).href,
        },
      });
    } catch {
      // The ticket stands and the firm sees it in Settings; ids only (hard rule 4).
      this.logger.warn(`Firm ${firmId}: the information request ${ticket.id} email failed`);
    }
  }

  /** The firm's first active owner, with the contact the email goes to; null when none. */
  private async ownerOf(
    firmId: string,
  ): Promise<{ userId: string; name: string; email: string } | null> {
    const db = this.admin.db;
    const membership = await db.membership.findFirst({
      where: { businessId: firmId, role: 'OWNER', status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: { userId: true },
    });
    if (!membership) return null;
    const user = await db.user.findUnique({
      where: { id: membership.userId },
      select: { name: true, email: true },
    });
    return user ? { userId: membership.userId, ...user } : null;
  }
}

function codeOf(error: HttpException): string | undefined {
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body
    ? String((body as { code: unknown }).code)
    : undefined;
}
