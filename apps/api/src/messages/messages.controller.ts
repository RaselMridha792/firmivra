import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  CreateMessageThreadRequest,
  CreateMyMessageThreadRequest,
  type FirmUnreadCount,
  ListMessageThreadsQuery,
  ListMyMessagesQuery,
  type Message,
  type MessageThread,
  type MessageThreadDetail,
  MessageThreadId,
  type MessageThreadList,
  type MyMessage,
  type MyMessageThread,
  type MyMessageThreadDetail,
  type MyMessageThreadList,
  SendMessageRequest,
  type UnreadCount,
  UpdateMessageThreadRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { ClientsActor } from '../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MessagesService } from './messages.service.js';

const clientPipe = new ZodValidationPipe(ClientId);
const idPipe = new ZodValidationPipe(MessageThreadId);
const sendPipe = new ZodValidationPipe(SendMessageRequest);

export function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/** The client's account from the session (TenantGuard), never from the URL. */
export function accountOf(tenant: TenantContext): string {
  if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
  return tenant.clientAccountId;
}

/** A client's threads (R20): Owner, Admin and Staff (Staff: their own clients). */
@Controller('business/clients/:id/message-threads')
@Roles(...FIRM_STAFF)
export class ClientMessageThreadsController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) clientId: string,
    @Query(new ZodValidationPipe(ListMessageThreadsQuery))
    q: z.output<typeof ListMessageThreadsQuery>,
  ): Promise<MessageThreadList> {
    return this.messages.listForClient(tenant.businessId, actorOf(auth, tenant), clientId, q);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) clientId: string,
    @Body(new ZodValidationPipe(CreateMessageThreadRequest))
    body: z.output<typeof CreateMessageThreadRequest>,
  ): Promise<MessageThreadDetail> {
    return this.messages.create(tenant.businessId, actorOf(auth, tenant), clientId, body);
  }
}

/** The firm's inbox and one thread. The firm comes from TenantGuard. */
@Controller('business/message-threads')
@Roles(...FIRM_STAFF)
export class MessageThreadsController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  inbox(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListMessageThreadsQuery))
    q: z.output<typeof ListMessageThreadsQuery>,
  ): Promise<MessageThreadList> {
    return this.messages.inbox(tenant.businessId, actorOf(auth, tenant), q);
  }

  // Before ':id', so the literal path wins.
  @Get('unread-count')
  unreadCount(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<FirmUnreadCount> {
    return this.messages.firmUnreadCount(tenant.businessId, actorOf(auth, tenant));
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageThreadDetail> {
    return this.messages.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateMessageThreadRequest))
    body: z.output<typeof UpdateMessageThreadRequest>,
  ): Promise<MessageThread> {
    return this.messages.setReplies(
      tenant.businessId,
      actorOf(auth, tenant),
      id,
      body.repliesEnabled,
    );
  }

  @Post(':id/messages')
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(sendPipe) body: z.output<typeof SendMessageRequest>,
  ): Promise<Message> {
    return this.messages.send(tenant.businessId, actorOf(auth, tenant), id, body.body);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageThread> {
    return this.messages.markRead(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/unread')
  @HttpCode(200)
  unread(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageThread> {
    return this.messages.markUnread(tenant.businessId, actorOf(auth, tenant), id);
  }
}

/** The signed-in client's messages at one firm (portal); the client from the session. */
@Controller('portal/:firmSlug/me/messages')
@Roles('CLIENT')
export class MyMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListMyMessagesQuery)) q: z.output<typeof ListMyMessagesQuery>,
  ): Promise<MyMessageThreadList> {
    return this.messages.myList(tenant.businessId, accountOf(tenant), q);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateMyMessageThreadRequest))
    body: z.output<typeof CreateMyMessageThreadRequest>,
  ): Promise<MyMessageThreadDetail> {
    return this.messages.myCreate(tenant.businessId, accountOf(tenant), body);
  }

  @Get('unread-count')
  unreadCount(@CurrentTenant() tenant: TenantContext): Promise<UnreadCount> {
    return this.messages.myUnreadCount(tenant.businessId, accountOf(tenant));
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MyMessageThreadDetail> {
    return this.messages.myGet(tenant.businessId, accountOf(tenant), id);
  }

  @Post(':id/messages')
  reply(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(sendPipe) body: z.output<typeof SendMessageRequest>,
  ): Promise<MyMessage> {
    return this.messages.myReply(tenant.businessId, accountOf(tenant), id, body.body);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MyMessageThread> {
    return this.messages.myMark(tenant.businessId, accountOf(tenant), id, true);
  }

  @Post(':id/unread')
  @HttpCode(200)
  unread(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MyMessageThread> {
    return this.messages.myMark(tenant.businessId, accountOf(tenant), id, false);
  }
}
