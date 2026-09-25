import { Injectable } from '@nestjs/common';
import type {
  Conversation,
  ConversationMessage,
  ConversationParticipant,
  Prisma,
} from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EventTypes } from '../../events/catalog';
import {
  assertCanRead,
  type ConversationParticipantAccess,
} from './domain/conversation-access';
import type {
  CreateConversationDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/conversation.dto';

type ConversationWithCounts = Conversation & {
  participants: ConversationParticipant[];
  _count: { participants: number; messages: number };
};

type ConversationDb = TenantClient | TxContext['db'];

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateConversationDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorUserId = this.tenantContext.requireUserId();
    const patientId = this.resolvePatientId(input.patientId);

    const conversation = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.branchId) {
        const branch = await ctx.db.branch.findFirst({
          where: { id: input.branchId, organizationId },
          select: { id: true },
        });
        if (!branch) throw notFound('Branch not found');
      }
      if (patientId) {
        const patient = await ctx.db.patient.findFirst({
          where: { id: patientId, organizationId },
          select: { id: true },
        });
        if (!patient) throw notFound('Patient not found');
      }

      const participantUserIds = [...new Set([actorUserId, ...input.participantUserIds])];
      const users = await ctx.db.user.findMany({
        where: { organizationId, id: { in: participantUserIds } },
        select: { id: true },
      });
      if (users.length !== participantUserIds.length) {
        throw notFound('One or more participants were not found in this organization');
      }

      const id = newId();
      const created = await ctx.db.conversation.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId ?? null,
          subject: input.subject,
          patientId: patientId ?? null,
          createdById: actorUserId,
        },
      });
      await ctx.db.conversationParticipant.createMany({
        data: participantUserIds.map((userId) => ({
          id: newId(),
          organizationId,
          conversationId: id,
          userId,
        })),
      });
      ctx.emit({
        type: EventTypes.ConversationCreated,
        aggregateType: 'conversation',
        aggregateId: id,
        payload: {
          conversationId: id,
          ...(patientId ? { patientId: patientId } : {}),
        },
      });
      return created;
    });

    return {
      conversation: serializeConversation(conversation, {
        participantCount: new Set([actorUserId, ...input.participantUserIds]).size,

        messageCount: 0,
      }),
    };
  }

  async list(query: ListConversationsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorUserId = this.tenantContext.requireUserId();
    const patientId = this.patientQueryScope(query.patientId);
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ConversationWhereInput = {
      organizationId,
      participants: { some: { userId: actorUserId } },
    };
    if (patientId) where.patientId = patientId;
    else if (query.patientId) where.patientId = query.patientId;
    if (query.branchId) where.branchId = query.branchId;

    const [rows, total] = await Promise.all([
      db.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { participants: true, messages: true } } },
      }),
      db.conversation.count({ where }),
    ]);

    return pageOf(
      rows.map((row) =>
        serializeConversation(row, {
          participantCount: row._count.participants,
          messageCount: row._count.messages,
        }),
      ),
      total,
      page,
      limit,
    );
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const conversation = await this.requireConversation(db, organizationId, id);
    this.assertConversationAccess(conversation);
    return {
      conversation: serializeConversation(conversation, {
        participantCount: conversation._count.participants,
        messageCount: conversation._count.messages,
      }),
    };
  }

  async listMessages(conversationId: string, query: ListMessagesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const conversation = await this.requireConversation(
      db,
      organizationId,
      conversationId,
    );
    this.assertConversationAccess(conversation);
    const { page, limit } = paginate(query);

    const where: Prisma.ConversationMessageWhereInput = {
      organizationId,
      conversationId,
    };
    const [rows, total] = await Promise.all([
      db.conversationMessage.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.conversationMessage.count({ where }),
    ]);
    await db.conversationParticipant.updateMany({
      where: {
        organizationId,
        conversationId,
        userId: this.tenantContext.requireUserId(),
      },
      data: { lastReadAt: new Date() },
    });

    return pageOf(rows.map(serializeMessage), total, page, limit);
  }

  async sendMessage(conversationId: string, input: SendMessageDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorUserId = this.tenantContext.requireUserId();
    const db = this.prisma.tenantFor(organizationId);
    const conversation = await this.requireConversation(
      db,
      organizationId,
      conversationId,
    );
    this.assertConversationAccess(conversation);

    if (input.documentId) {
      const document = await db.document.findFirst({
        where: { id: input.documentId, organizationId },
        select: { id: true },
      });
      if (!document) throw notFound('Document not found');
    }

    const message = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.conversation.findFirst({
        where: { id: conversationId, organizationId },
        include: {
          participants: { select: { userId: true } },
        },
      });
      if (!current) throw notFound('Conversation not found');
      this.assertConversationAccess(current);

      const created = await ctx.db.conversationMessage.create({
        data: {
          id: newId(),
          organizationId,
          conversationId,
          senderId: actorUserId,
          body: input.body,
          documentId: input.documentId ?? null,
        },
      });
      await ctx.db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      ctx.emit({
        type: EventTypes.ConversationMessageSent,
        aggregateType: 'conversation_message',
        aggregateId: created.id,
        payload: { conversationId, messageId: created.id },
      });
      return created;
    });

    return { message: serializeMessage(message) };
  }

  async addParticipant(conversationId: string, userId: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorUserId = this.tenantContext.requireUserId();
    this.assertStaffPrincipal();

    const participant = await this.txRunner.run(async (ctx: TxContext) => {
      const conversation = await ctx.db.conversation.findFirst({
        where: { id: conversationId, organizationId },
        include: { participants: true },
      });
      if (!conversation) throw notFound('Conversation not found');
      this.assertCanManageConversation(conversation, actorUserId);

      const user = await ctx.db.user.findFirst({
        where: { id: userId, organizationId },
        select: { id: true },
      });
      if (!user) throw notFound('User not found in this organization');

      const existing = await ctx.db.conversationParticipant.findFirst({
        where: { organizationId, conversationId, userId },
      });
      if (existing) return existing;
      return ctx.db.conversationParticipant.create({
        data: {
          id: newId(),
          organizationId,
          conversationId,
          userId,
        },
      });
    });

    return { participant: serializeParticipant(participant) };
  }

  async removeParticipant(conversationId: string, userId: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorUserId = this.tenantContext.requireUserId();
    this.assertStaffPrincipal();

    await this.txRunner.run(async (ctx: TxContext) => {
      const conversation = await ctx.db.conversation.findFirst({
        where: { id: conversationId, organizationId },
        include: { participants: true },
      });
      if (!conversation) throw notFound('Conversation not found');
      this.assertCanManageConversation(conversation, actorUserId);
      if (conversation.createdById === userId) {
        throw forbidden('The conversation creator cannot be removed.');
      }

      const participant = await ctx.db.conversationParticipant.findFirst({
        where: { organizationId, conversationId, userId },
      });
      if (!participant) return;
      await ctx.db.conversationParticipant.delete({ where: { id: participant.id } });
    });

    return { removed: true };
  }

  private async requireConversation(
    db: ConversationDb,
    organizationId: string,
    id: string,
  ): Promise<ConversationWithCounts> {
    const conversation = await db.conversation.findFirst({
      where: { id, organizationId },
      include: {
        participants: true,
        _count: { select: { participants: true, messages: true } },
      },
    });
    if (!conversation) throw notFound('Conversation not found');
    return conversation;
  }

  private assertConversationAccess(conversation: {
    participants: readonly ConversationParticipantAccess[];
    patientId: string | null;
  }): void {
    assertCanRead({
      actorUserId: this.tenantContext.requireUserId(),
      actorPatientId: this.patientScope(),
      participants: conversation.participants,
      patientId: conversation.patientId,
    });
  }

  private assertCanManageConversation(
    conversation: Conversation & { participants: ConversationParticipant[] },
    actorUserId: string,
  ): void {
    if (conversation.createdById === actorUserId) return;
    if (
      this.tenantContext.scope.permissions.includes(PERMISSION_GROUPS.messaging.manage)
    ) {
      return;
    }
    this.assertConversationAccess(conversation);
    throw forbidden(
      'Only the conversation creator or a messaging manager can manage participants.',
    );
  }

  private patientQueryScope(requestedPatientId?: string): string | null {
    const scopedPatientId = this.patientScope();
    if (
      scopedPatientId != null &&
      requestedPatientId != null &&
      scopedPatientId !== requestedPatientId
    ) {
      throw patientAccessDenied();
    }
    return scopedPatientId;
  }

  private resolvePatientId(requestedPatientId?: string): string | null {
    const scopedPatientId = this.patientScope();
    if (
      scopedPatientId != null &&
      requestedPatientId != null &&
      scopedPatientId !== requestedPatientId
    ) {
      throw new AppError({
        code: ErrorCodes.CONVERSATION_ACCESS_DENIED,
        message: 'A patient may only create conversations for their own patient context.',
        silent: true,
      });
    }
    return scopedPatientId ?? requestedPatientId ?? null;
  }

  private patientScope(): string | null {
    const scope = this.tenantContext.scope;
    if (scope.patientId != null) return scope.patientId;
    if (scope.roles.includes('PATIENT')) {
      throw patientAccessDenied('Patient self-scope is required.');
    }
    return null;
  }

  private assertStaffPrincipal(): void {
    const scope = this.tenantContext.scope;
    if (scope.patientId != null || scope.roles.includes('PATIENT')) {
      throw patientAccessDenied('Patient principals cannot use this staff operation.');
    }
  }
}

function serializeConversation(
  conversation: Conversation,
  counts: { participantCount: number; messageCount: number },
) {
  return {
    id: conversation.id,
    organizationId: conversation.organizationId,
    branchId: conversation.branchId,
    subject: conversation.subject,
    patientId: conversation.patientId,
    createdById: conversation.createdById,
    participantCount: counts.participantCount,
    messageCount: counts.messageCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function serializeMessage(message: ConversationMessage) {
  return {
    id: message.id,
    organizationId: message.organizationId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    documentId: message.documentId,
    createdAt: message.createdAt,
  };
}

function serializeParticipant(participant: ConversationParticipant) {
  return {
    id: participant.id,
    organizationId: participant.organizationId,
    conversationId: participant.conversationId,
    userId: participant.userId,
    joinedAt: participant.joinedAt,
    lastReadAt: participant.lastReadAt,
  };
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function forbidden(message: string): AppError {
  return new AppError({ code: ErrorCodes.PERMISSION_DENIED, message, silent: true });
}

function patientAccessDenied(message = 'Patient access denied.'): AppError {
  return new AppError({ code: ErrorCodes.PATIENT_ACCESS_DENIED, message, silent: true });
}
