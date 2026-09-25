import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { NotificationService } from './notifications.service';
import {
  ListNotificationPreferencesQueryDto,
  ListNotificationsQueryDto,
  ListNotificationTemplatesQueryDto,
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  NotificationTemplateResponseDto,
  UpdateNotificationPreferenceDto,
  UpsertNotificationTemplateDto,
} from './dto/notification.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('templates')
  @ApiEndpoint({
    summary: 'List notification templates',
    operationId: 'notificationsTemplatesList',
    permissions: [PERMISSION_GROUPS.notifications.read],
    errors: [],
  })
  listTemplates(@Query() query: ListNotificationTemplatesQueryDto) {
    return this.notifications.listTemplates(query);
  }

  @Post('templates')
  @ApiEndpoint({
    summary: 'Create or update a neutral notification template',
    operationId: 'notificationsTemplatesUpsert',
    permissions: [PERMISSION_GROUPS.notifications.manage],
    statusCode: 201,
    responseType: NotificationTemplateResponseDto,
    errors: [
      { status: 403, description: 'Template content is not neutral' },
      { status: 409, description: 'Template key already exists' },
    ],
  })
  upsertTemplate(@Body() body: UpsertNotificationTemplateDto) {
    return this.notifications.upsertTemplate(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List notifications for the current principal',
    operationId: 'notificationsList',
    permissions: [PERMISSION_GROUPS.notifications.read],
    errors: [],
  })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Patch(':id/read')
  @ApiEndpoint({
    summary: 'Mark one of the current principal notifications as read',
    operationId: 'notificationsMarkRead',
    permissions: [PERMISSION_GROUPS.notifications.read],
    responseType: NotificationResponseDto,
    errors: [{ status: 404, description: 'Notification not found' }],
  })
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Get('preferences')
  @ApiEndpoint({
    summary: 'List notification preferences for the current principal',
    operationId: 'notificationsPreferencesList',
    permissions: [PERMISSION_GROUPS.notifications.read],
    errors: [],
  })
  listPreferences(@Query() query: ListNotificationPreferencesQueryDto) {
    return this.notifications.listPreferences(query);
  }

  @Put('preferences')
  @ApiEndpoint({
    summary: 'Update a notification preference for the current principal',
    operationId: 'notificationsPreferencesUpdate',
    permissions: [PERMISSION_GROUPS.notifications.read],
    responseType: NotificationPreferenceResponseDto,
    errors: [],
  })
  updatePreference(@Body() body: UpdateNotificationPreferenceDto) {
    return this.notifications.updatePreference(body);
  }
}
