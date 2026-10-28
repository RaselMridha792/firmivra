import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.controller.js';
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
import { PortalTabsModule } from '../client-portal/portal-tabs.js';

/**
 * Messages and notes (R20): firm threads, the portal's messages, read state and counts; Messages
 * Settings (R60).
 */
@Module({
  imports: [NotificationsModule, PortalTabsModule],
  controllers: [
    ClientMessageThreadsController,
    MessageThreadsController,
    MyMessagesController,
    ClientNotesController,
    NotesController,
    MyNotesController,
    MessageSettingsController,
  ],
  providers: [MessagesService, NotesService, MessageNotices, MessageSettingsService],
  exports: [MessagesService],
})
export class MessagesModule {}
