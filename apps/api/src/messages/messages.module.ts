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

/** Messages and notes (R20): firm threads, the portal's messages, read state and counts. */
@Module({
  imports: [NotificationsModule],
  controllers: [
    ClientMessageThreadsController,
    MessageThreadsController,
    MyMessagesController,
    ClientNotesController,
    NotesController,
    MyNotesController,
  ],
  providers: [MessagesService, NotesService, MessageNotices],
  exports: [MessagesService],
})
export class MessagesModule {}
