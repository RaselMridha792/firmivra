import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { MessageNotices } from './message-notices.js';
import {
  ClientMessageThreadsController,
  MessageThreadsController,
  MyMessagesController,
} from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { ClientNotesController, MyNotesController, NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';
import { OutboundMessagesController } from './outbound.controller.js';
import { OutboundMessagesJob } from './outbound.job.js';
import { OutboundMessagesService } from './outbound.service.js';
import { PortalTabsModule } from '../client-portal/portal-tabs.js';
import { TemplatesModule } from '../templates/templates.module.js';

/**
 * Messages and notes (R20): firm threads, the portal's messages, read state and counts; New
 * Message's drafts, schedules and sends (R60).
 */
@Module({
  imports: [NotificationsModule, PortalTabsModule, TemplatesModule],
  controllers: [
    ClientMessageThreadsController,
    MessageThreadsController,
    MyMessagesController,
    ClientNotesController,
    NotesController,
    MyNotesController,
    OutboundMessagesController,
  ],
  providers: [
    MessagesService,
    NotesService,
    MessageNotices,
    OutboundMessagesService,
    OutboundMessagesJob,
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
