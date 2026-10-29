import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { LeadMessageThreadsController } from './lead-threads.controller.js';
import { LeadThreadsService } from './lead-threads.service.js';
import { MessageNotices } from './message-notices.js';
import { MessageSettingsController } from './message-settings.controller.js';
import { MessageSettingsService } from './message-settings.service.js';
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
 * Messages and notes (R20): firm threads, the portal's messages, read state and counts; Messages
 * Settings, New Message's drafts, schedules and sends, and conversations with leads (R60).
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
    MessageSettingsController,
    LeadMessageThreadsController,
  ],
  providers: [
    MessagesService,
    NotesService,
    MessageNotices,
    MessageSettingsService,
    OutboundMessagesService,
    OutboundMessagesJob,
    LeadThreadsService,
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
