import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateConversationSchema = z.object({
  subject: z.string().trim().min(1).max(255),
  branchId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  participantUserIds: z.array(z.string().uuid()).max(100).default([]),
});
export class CreateConversationDto extends createZodDto(CreateConversationSchema) {}

export const ListConversationsQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListConversationsQueryDto extends createZodDto(
  ListConversationsQuerySchema,
) {}

export const SendMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  documentId: z.string().uuid().optional(),
});
export class SendMessageDto extends createZodDto(SendMessageSchema) {}

export const ListMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListMessagesQueryDto extends createZodDto(ListMessagesQuerySchema) {}

export const ConversationResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string().nullable(),
  subject: z.string(),
  patientId: z.string().nullable(),
  createdById: z.string(),
  participantCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class ConversationResponseDto extends createZodDto(ConversationResponseSchema) {}

export const ConversationMessageResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  body: z.string(),
  documentId: z.string().nullable(),
  createdAt: z.date(),
});
export class ConversationMessageResponseDto extends createZodDto(
  ConversationMessageResponseSchema,
) {}

export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationResponseSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export class ConversationListResponseDto extends createZodDto(
  ConversationListResponseSchema,
) {}

export const ConversationMessageListResponseSchema = z.object({
  items: z.array(ConversationMessageResponseSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export class ConversationMessageListResponseDto extends createZodDto(
  ConversationMessageListResponseSchema,
) {}

export const ConversationParticipantResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  conversationId: z.string(),
  userId: z.string(),
  joinedAt: z.date(),
  lastReadAt: z.date().nullable(),
});
export class ConversationParticipantResponseDto extends createZodDto(
  ConversationParticipantResponseSchema,
) {}

export const ConversationRemovalResponseSchema = z.object({
  removed: z.literal(true),
});
export class ConversationRemovalResponseDto extends createZodDto(
  ConversationRemovalResponseSchema,
) {}
