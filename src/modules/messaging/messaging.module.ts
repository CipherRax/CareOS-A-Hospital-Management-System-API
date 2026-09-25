import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { ConversationsService } from './conversations.service';

@Module({
  controllers: [MessagesController],
  providers: [ConversationsService],
})
export class MessagingModule {}
