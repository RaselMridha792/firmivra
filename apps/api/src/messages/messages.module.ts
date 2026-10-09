import { Module } from '@nestjs/common';
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
  controllers: [
    ClientMessageThreadsController,
    MessageThreadsController,
    MyMessagesController,
    ClientNotesController,
    NotesController,
    MyNotesController,
  ],
  providers: [MessagesService, NotesService],
  exports: [MessagesService],
})
export class MessagesModule {}
