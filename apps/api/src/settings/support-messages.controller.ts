import { Body, Controller, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { SendSupportMessageRequest, type SupportMessageSent } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import {
  duplicateKey,
  isUniqueViolation,
  raiseTicket,
  ticketByKey,
  type TicketRow,
} from './firm-tickets.js';

type Body = z.output<typeof SendSupportMessageRequest>;

/** Every support message's subject starts so; the Super Admin queue tells it from other requests. */
const PREFIX = 'Support message: ';

/**
 * Help & Support's in-app message (Octavia's dashboard review of Oct 25, D2): a ticket in the
 * Super Admin's queue, raised in the firm's scope with the member as creator and contact (the
 * `support_tickets_firm_raise` policy). The audit row names the ticket, never the text.
 */
@Injectable()
export class SupportMessagesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, userId: string, fn: (tx: TxClient) => Promise<T>) {
    return this.database.withScope({ kind: 'business', businessId, actorUserId: userId }, fn);
  }

  /** The ticket a key already made, if it is this member's support message; else a conflict. */
  private async replay(businessId: string, userId: string, key: string) {
    const row = await this.inFirm(businessId, userId, (tx) => ticketByKey(tx, businessId, key));
    if (!row) return null;
    if (!row.subject.startsWith(PREFIX)) throw duplicateKey();
    return row;
  }

  private sent = (row: TicketRow): SupportMessageSent => ({
    number: row.number,
    sentAt: row.createdAt.toISOString(),
  });

  async send(businessId: string, userId: string, body: Body): Promise<SupportMessageSent> {
    const before = await this.replay(businessId, userId, body.requestId);
    if (before) return this.sent(before);
    try {
      return await this.inFirm(businessId, userId, async (tx) => {
        const row = await raiseTicket(tx, {
          businessId,
          userId,
          requestId: body.requestId,
          subject: `${PREFIX}${body.subject}`,
          description: body.page ? `${body.message}\n\nPage: ${body.page}` : body.message,
          category: 'General',
          priority: 'MEDIUM',
        });
        await this.audit.logIn(
          tx,
          'support.message_sent',
          { type: 'support_ticket', id: row.id },
          { number: row.number },
          { businessId, actorUserId: userId },
        );
        return this.sent(row);
      });
    } catch (error) {
      // Two clicks at once: the second finds the first's ticket.
      if (isUniqueViolation(error)) {
        const again = await this.replay(businessId, userId, body.requestId);
        if (again) return this.sent(again);
        throw duplicateKey();
      }
      throw error;
    }
  }
}

/** POST /business/support/messages: any member of the firm (Owner, Admin, Staff). */
@Controller('business/support/messages')
@Roles(...FIRM_STAFF)
export class SupportMessagesController {
  constructor(private readonly messages: SupportMessagesService) {}

  @Post()
  @HttpCode(201)
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SendSupportMessageRequest)) body: Body,
  ): Promise<SupportMessageSent> {
    return this.messages.send(tenant.businessId, auth.userId, body);
  }
}
