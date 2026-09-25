import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ConversationsService } from './conversations.service';
import {
  ConversationListResponseDto,
  ConversationMessageListResponseDto,
  ConversationMessageResponseDto,
  ConversationParticipantResponseDto,
  ConversationRemovalResponseDto,
  ConversationResponseDto,
  CreateConversationDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/conversation.dto';

@Controller('conversations')
export class MessagesController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a secure conversation',
    operationId: 'messagingCreateConversation',
    permissions: [PERMISSION_GROUPS.messaging.send],
    statusCode: 201,
    responseType: ConversationResponseDto,
  })
  create(@Body() body: CreateConversationDto) {
    return this.conversations.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List the current user’s conversations',
    operationId: 'messagingListConversations',
    permissions: [PERMISSION_GROUPS.messaging.read],
    responseType: ConversationListResponseDto,
  })
  list(@Query() query: ListConversationsQueryDto) {
    return this.conversations.list(query);
  }

  @Get(':id/messages')
  @ApiEndpoint({
    summary: 'List messages in a conversation',
    operationId: 'messagingListMessages',
    permissions: [PERMISSION_GROUPS.messaging.read],
    responseType: ConversationMessageListResponseDto,
    errors: [{ status: 403, description: 'Conversation access denied' }],
  })
  listMessages(@Param('id') id: string, @Query() query: ListMessagesQueryDto) {
    return this.conversations.listMessages(id, query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a conversation',
    operationId: 'messagingGetConversation',
    permissions: [PERMISSION_GROUPS.messaging.read],
    responseType: ConversationResponseDto,
    errors: [{ status: 403, description: 'Conversation access denied' }],
  })
  get(@Param('id') id: string) {
    return this.conversations.get(id);
  }

  @Post(':id/messages')
  @ApiEndpoint({
    summary: 'Append a message to a conversation',
    operationId: 'messagingSendMessage',
    permissions: [PERMISSION_GROUPS.messaging.send],
    statusCode: 201,
    responseType: ConversationMessageResponseDto,
    errors: [
      { status: 403, description: 'Conversation access denied' },
      { status: 404, description: 'Conversation or document not found' },
    ],
  })
  sendMessage(@Param('id') id: string, @Body() body: SendMessageDto) {
    return this.conversations.sendMessage(id, body);
  }

  @Patch(':id/participants/:userId')
  @ApiEndpoint({
    summary: 'Add a conversation participant',
    operationId: 'messagingAddParticipant',
    permissions: [PERMISSION_GROUPS.messaging.manage],
    responseType: ConversationParticipantResponseDto,
    errors: [
      { status: 403, description: 'Conversation management denied' },
      { status: 404, description: 'Conversation or user not found' },
    ],
  })
  addParticipant(@Param('id') id: string, @Param('userId') userId: string) {
    return this.conversations.addParticipant(id, userId);
  }

  @Delete(':id/participants/:userId')
  @ApiEndpoint({
    summary: 'Remove a conversation participant',
    operationId: 'messagingRemoveParticipant',
    permissions: [PERMISSION_GROUPS.messaging.manage],
    responseType: ConversationRemovalResponseDto,
    errors: [
      { status: 403, description: 'The creator cannot be removed' },
      { status: 404, description: 'Conversation not found' },
    ],
  })
  removeParticipant(@Param('id') id: string, @Param('userId') userId: string) {
    return this.conversations.removeParticipant(id, userId);
  }
}
