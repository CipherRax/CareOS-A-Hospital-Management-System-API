import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Notification,
  type NotificationPreference,
  type NotificationTemplate,
  type NotificationChannel,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import {
  BUILT_IN_TEMPLATES,
  ensureNeutralBody,
  renderTemplate,
} from './domain/notification-templates';
import type {
  ListNotificationPreferencesQueryDto,
  ListNotificationsQueryDto,
  ListNotificationTemplatesQueryDto,
  UpdateNotificationPreferenceDto,
  UpsertNotificationTemplateDto,
} from './dto/notification.dto';

export interface CreateNotificationForUserInput {
  id?: string;
  userId: string;
  channel: NotificationChannel;
  templateKey: string;
  variables?: Record<string, unknown>;
  organizationId: string;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async listTemplates(query: ListNotificationTemplatesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);
    const where: Prisma.NotificationTemplateWhereInput = { organizationId };
    if (query.key) where.key = query.key;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [rows, total] = await Promise.all([
      db.notificationTemplate.findMany({
        where,
        orderBy: { key: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notificationTemplate.count({ where }),
    ]);
    return pageOf(rows.map(serializeTemplate), total, page, limit);
  }

  async getTemplate(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const template = await this.prisma
      .tenantFor(organizationId)
      .notificationTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw notFound('Notification template not found');
    return { template: serializeTemplate(template) };
  }

  async upsertTemplate(input: UpsertNotificationTemplateDto) {
    const organizationId = this.tenantContext.requireOrg();
    const updatedById = this.tenantContext.requireUserId();
    assertNeutral(input.subjectTemplate, input.bodyTemplate);

    const template = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.notificationTemplate.findFirst({
        where: { organizationId, key: input.key },
      });
      const data = {
        name: input.name,
        description: input.description ?? null,
        subjectTemplate: input.subjectTemplate,
        bodyTemplate: input.bodyTemplate,
        allowlistedVariables: input.allowlistedVariables,
        isDefault: input.isDefault,
        isActive: input.isActive,
        updatedById,
      };
      if (current) {
        return ctx.db.notificationTemplate.update({
          where: { id: current.id, organizationId },
          data,
        });
      }
      return ctx.db.notificationTemplate.create({
        data: {
          id: newId(),
          organizationId,
          key: input.key,
          ...data,
        },
      });
    });
    return { template: serializeTemplate(template) };
  }

  async list(query: ListNotificationsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);
    const where = this.principalNotificationWhere(organizationId);
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.unreadOnly) where.readAt = null;

    const [rows, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notification.count({ where }),
    ]);
    return pageOf(rows.map(serializeNotification), total, page, limit);
  }

  async markRead(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const where = { id, ...this.principalNotificationWhere(organizationId) };
    const current = await db.notification.findFirst({ where });
    if (!current) throw notFound('Notification not found');
    const notification = await db.notification.update({
      where: { id, organizationId },
      data: { readAt: current.readAt ?? new Date() },
    });
    return { notification: serializeNotification(notification) };
  }

  async listPreferences(query: ListNotificationPreferencesQueryDto = {}) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);
    const where = this.principalPreferenceWhere(organizationId);
    const [rows, total] = await Promise.all([
      db.notificationPreference.findMany({
        where,
        orderBy: [{ category: 'asc' }, { channel: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notificationPreference.count({ where }),
    ]);
    return pageOf(rows.map(serializePreference), total, page, limit);
  }

  async updatePreference(input: UpdateNotificationPreferenceDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const principal = this.principalIdentity(organizationId);
    if (principal.patientId) {
      const preference = await db.notificationPreference.upsert({
        where: {
          organizationId_recipientPatientId_category_channel: {
            organizationId,
            recipientPatientId: principal.patientId,
            category: input.category,
            channel: input.channel,
          },
        },
        create: {
          id: newId(),
          organizationId,
          recipientUserId: null,
          recipientPatientId: principal.patientId,
          category: input.category,
          channel: input.channel,
          enabled: input.enabled,
        },
        update: { enabled: input.enabled },
      });
      return { preference: serializePreference(preference) };
    }

    const userId = principal.userId;
    if (!userId) throw notFound('Notification recipient not found');
    const preference = await db.notificationPreference.upsert({
      where: {
        organizationId_recipientUserId_category_channel: {
          organizationId,
          recipientUserId: userId,
          category: input.category,
          channel: input.channel,
        },
      },
      create: {
        id: newId(),
        organizationId,
        recipientUserId: userId,
        recipientPatientId: null,
        category: input.category,
        channel: input.channel,
        enabled: input.enabled,
      },
      update: { enabled: input.enabled },
    });
    return { preference: serializePreference(preference) };
  }

  async createForUser(input: CreateNotificationForUserInput): Promise<Notification> {
    const variables = normalizeVariables(input.variables ?? {});
    return this.txRunner.run(
      async (ctx: TxContext) => {
        const custom = await ctx.db.notificationTemplate.findFirst({
          where: { organizationId: input.organizationId, key: input.templateKey },
        });
        const template = custom?.isActive
          ? custom
          : BUILT_IN_TEMPLATES[input.templateKey];
        if (!template) throw notFound('Notification template not found');

        const rendered = renderTemplate(template, variables);
        assertNeutral(rendered.subject, rendered.body);
        const id = input.id ?? newId();
        const notification = await ctx.db.notification.upsert({
          where: { id },
          create: {
            id,
            organizationId: input.organizationId,
            recipientUserId: input.userId,
            recipientPatientId: null,
            channel: input.channel,
            templateKey: input.templateKey,
            subject: rendered.subject,
            body: rendered.body,
            variables: variables as Prisma.InputJsonObject,
            status: 'PENDING',
          },
          update: {},
        });
        ctx.emit({
          type: EventTypes.NotificationsQueued,
          aggregateType: 'Notification',
          aggregateId: notification.id,
          payload: { notificationIds: [notification.id] },
        });
        return notification;
      },
      { organizationId: input.organizationId },
    );
  }

  private principalIdentity(
    organizationId: string,
  ):
    | { organizationId: string; userId: string; patientId: null }
    | { organizationId: string; userId: null; patientId: string } {
    const patientId = this.tenantContext.scope.patientId;
    if (patientId) return { organizationId, userId: null, patientId };
    return {
      organizationId,
      userId: this.tenantContext.requireUserId(),
      patientId: null,
    };
  }

  private principalNotificationWhere(
    organizationId: string,
  ): Prisma.NotificationWhereInput {
    const principal = this.principalIdentity(organizationId);
    return principal.patientId
      ? {
          organizationId,
          recipientPatientId: principal.patientId,
          recipientUserId: null,
        }
      : {
          organizationId,
          recipientUserId: principal.userId,
          recipientPatientId: null,
        };
  }

  private principalPreferenceWhere(
    organizationId: string,
  ): Prisma.NotificationPreferenceWhereInput {
    const principal = this.principalIdentity(organizationId);
    return principal.patientId
      ? { organizationId, recipientPatientId: principal.patientId, recipientUserId: null }
      : { organizationId, recipientUserId: principal.userId, recipientPatientId: null };
  }
}

function normalizeVariables(variables: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key,
      value === null || value === undefined ? '' : String(value),
    ]),
  );
}

function assertNeutral(subject: string, body: string): void {
  if (ensureNeutralBody(subject, body).length > 0) {
    throw new AppError({
      code: ErrorCodes.NOTIFICATION_TEMPLATE_FORBIDDEN,
      message: 'Notification content must not contain contact or credential data.',
      silent: true,
    });
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serializeNotification(notification: Notification) {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    recipientUserId: notification.recipientUserId,
    recipientPatientId: notification.recipientPatientId,
    channel: notification.channel,
    templateKey: notification.templateKey,
    subject: notification.subject,
    body: notification.body,
    variables: notification.variables,
    status: notification.status,
    attemptCount: notification.attemptCount,
    errorCode: notification.errorCode,
    readAt: notification.readAt,
    sentAt: notification.sentAt,
    createdAt: notification.createdAt,
  };
}

export function serializeTemplate(template: NotificationTemplate) {
  return {
    id: template.id,
    organizationId: template.organizationId,
    key: template.key,
    name: template.name,
    description: template.description,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    allowlistedVariables: template.allowlistedVariables,
    isDefault: template.isDefault,
    isActive: template.isActive,
    updatedById: template.updatedById,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function serializePreference(preference: NotificationPreference) {
  return {
    id: preference.id,
    organizationId: preference.organizationId,
    recipientUserId: preference.recipientUserId,
    recipientPatientId: preference.recipientPatientId,
    category: preference.category,
    channel: preference.channel,
    enabled: preference.enabled,
    createdAt: preference.createdAt,
    updatedAt: preference.updatedAt,
  };
}
