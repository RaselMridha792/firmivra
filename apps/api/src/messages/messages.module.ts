import { Module } from '@nestjs/common';
import {
  ClientMessageThreadsController,
  MessageThreadsController,
  MyMessagesController,
} from './messages.controller.js';
import { MessagesService } from './messages.service.js';

/** Messages and notes (R20): firm threads, the portal's messages, read state and counts. */
@Module({
  controllers: [ClientMessageThreadsController, MessageThreadsController, MyMessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
