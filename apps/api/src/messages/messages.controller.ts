import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  ClientId,
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  type FirmMessage,
  type InternalNote,
  type InternalNoteList,
  ListInternalNotesQuery,
  ListMessageThreadsQuery,
  ListMyMessageThreadsQuery,
  type MessageThread,
  type MessageThreadDetail,
  MessageThreadId,
  type MessageThreadList,
  type MyMessage,
  type MyMessageThread,
  type MyMessageThreadDetail,
  type MyMessageThreadList,
  type MyNotepad,
  SaveMyNoteRequest,
  SendMessageRequest,
  SetMyNoteReminderRequest,
  StartMyMessageThreadRequest,
  type UnreadMessageCount,
  UpdateMessageThreadRequest,
} from '@firmivra/types';
import { FIRM_STAFF, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MessageNotices } from './message-notices.js';
import { MessagesService, type Viewer } from './messages.service.js';
import { NotesService } from './notes.service.js';

const id = new ZodValidationPipe(MessageThreadId);
const clientId = new ZodValidationPipe(ClientId);
const valid = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
type In<S extends z.ZodType> = z.output<S>;

/**
 * The signed-in member (firm routes) or portal login (portal routes) from the guards' context:
 * the firm from TenantGuard, a client's account from the session, never from the URL.
 */
const Who = createParamDecorator((_: unknown, ctx: ExecutionContext): Viewer => {
  const { auth, tenant } = ctx.switchToHttp().getRequest<Request>();
  if (!auth || !tenant) throw new Error('message routes need a firm role (check @Roles)');
  const { businessId } = tenant;
  return tenant.kind === 'staff'
    ? { kind: 'staff', businessId, userId: auth.userId, role: tenant.role }
    : { kind: 'client', businessId, userId: auth.userId, clientAccountId: tenant.clientAccountId };
});
type Staff = Viewer & { kind: 'staff' };

/** The firm's threads and internal notes (R11 step 6): Owner, Admin and Staff (own clients). */
@Controller('business')
@Roles(...FIRM_STAFF)
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly notes: NotesService,
  ) {}

  @Get('message-threads')
  list(
    @Who() v: Viewer,
    @Query(valid(ListMessageThreadsQuery)) q: In<typeof ListMessageThreadsQuery>,
  ) {
    return this.messages.list(v, q) as Promise<MessageThreadList>;
  }

  @Get('message-threads/unread-count')
  unread(@Who() v: Viewer): Promise<UnreadMessageCount> {
    return this.messages.unreadCount(v);
  }

  @Get('message-threads/:id')
  get(@Who() v: Viewer, @Param('id', id) thread: string) {
    return this.messages.get(v, thread) as Promise<MessageThreadDetail>;
  }

  @Post('clients/:id/message-threads')
  create(
    @Who() v: Viewer,
    @Param('id', clientId) client: string,
    @Body(valid(CreateMessageThreadRequest)) body: In<typeof CreateMessageThreadRequest>,
  ) {
    return this.messages.create(v, body, client) as Promise<MessageThreadDetail>;
  }

  @Patch('message-threads/:id')
  update(
    @Who() v: Viewer,
    @Param('id', id) thread: string,
    @Body(valid(UpdateMessageThreadRequest)) body: In<typeof UpdateMessageThreadRequest>,
  ) {
    return this.messages.setReplies(v, thread, body.repliesEnabled) as Promise<MessageThread>;
  }

  @Post('message-threads/:id/messages')
  reply(
    @Who() v: Viewer,
    @Param('id', id) thread: string,
    @Body(valid(SendMessageRequest)) body: In<typeof SendMessageRequest>,
  ) {
    return this.messages.reply(v, thread, body) as Promise<FirmMessage>;
  }

  @Post('message-threads/:id/read')
  @HttpCode(200)
  read(@Who() v: Viewer, @Param('id', id) thread: string) {
    return this.messages.mark(v, thread, true) as Promise<MessageThread>;
  }

  @Post('message-threads/:id/unread')
  @HttpCode(200)
  markUnread(@Who() v: Viewer, @Param('id', id) thread: string) {
    return this.messages.mark(v, thread, false) as Promise<MessageThread>;
  }

  @Get('clients/:id/notes')
  listNotes(
    @Who() v: Staff,
    @Param('id', clientId) client: string,
    @Query(valid(ListInternalNotesQuery)) q: In<typeof ListInternalNotesQuery>,
  ): Promise<InternalNoteList> {
    return this.notes.list(v, client, q);
  }

  @Post('clients/:id/notes')
  addNote(
    @Who() v: Staff,
    @Param('id', clientId) client: string,
    @Body(valid(CreateInternalNoteRequest)) body: In<typeof CreateInternalNoteRequest>,
  ): Promise<InternalNote> {
    return this.notes.create(v, client, body);
  }
}

/** The signed-in client's threads and the login's own notepad (portal). */
@Controller('portal/:firmSlug/me')
@Roles('CLIENT')
export class MyMessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly notes: NotesService,
  ) {}

  @Get('message-threads')
  list(
    @Who() v: Viewer,
    @Query(valid(ListMyMessageThreadsQuery)) q: In<typeof ListMyMessageThreadsQuery>,
  ) {
    return this.messages.list(v, q) as Promise<MyMessageThreadList>;
  }

  @Get('message-threads/unread-count')
  unread(@Who() v: Viewer): Promise<UnreadMessageCount> {
    return this.messages.unreadCount(v);
  }

  @Get('message-threads/:id')
  get(@Who() v: Viewer, @Param('id', id) thread: string) {
    return this.messages.get(v, thread) as Promise<MyMessageThreadDetail>;
  }

  @Post('message-threads')
  start(
    @Who() v: Viewer,
    @Body(valid(StartMyMessageThreadRequest)) body: In<typeof StartMyMessageThreadRequest>,
  ) {
    return this.messages.create(v, body) as Promise<MyMessageThreadDetail>;
  }

  @Post('message-threads/:id/messages')
  reply(
    @Who() v: Viewer,
    @Param('id', id) thread: string,
    @Body(valid(SendMessageRequest)) body: In<typeof SendMessageRequest>,
  ) {
    return this.messages.reply(v, thread, body) as Promise<MyMessage>;
  }

  @Post('message-threads/:id/read')
  @HttpCode(200)
  read(@Who() v: Viewer, @Param('id', id) thread: string) {
    return this.messages.mark(v, thread, true) as Promise<MyMessageThread>;
  }

  @Post('message-threads/:id/unread')
  @HttpCode(200)
  markUnread(@Who() v: Viewer, @Param('id', id) thread: string) {
    return this.messages.mark(v, thread, false) as Promise<MyMessageThread>;
  }

  @Get('notes')
  notepad(@Who() v: Viewer): Promise<MyNotepad> {
    return this.notes.notepad(v);
  }

  @Put('notes')
  save(
    @Who() v: Viewer,
    @Body(valid(SaveMyNoteRequest)) body: In<typeof SaveMyNoteRequest>,
  ): Promise<MyNotepad> {
    return this.notes.save(v, body);
  }

  @Put('notes/reminder')
  remind(
    @Who() v: Viewer,
    @Body(valid(SetMyNoteReminderRequest)) body: In<typeof SetMyNoteReminderRequest>,
  ): Promise<MyNotepad> {
    return this.notes.setReminder(v, body.remindAt);
  }
}

@Module({
  controllers: [MessagesController, MyMessagesController],
  providers: [MessagesService, NotesService, MessageNotices],
})
export class MessagesModule {}
