import { Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';

export const NOTIFICATION_PROVIDERS = 'NOTIFICATION_PROVIDERS';

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(opts: {
    to: string;
    subject: string;
    body: string;
    variables?: Record<string, string>;
  }): Promise<{ delivered: boolean; ref?: string }>;
}

function logDelivery(
  logger: Logger,
  channel: NotificationChannel,
  opts: Parameters<NotificationProvider['send']>[0],
): void {
  logger.debug(
    `Notification provider accepted channel=${channel} subjectLength=${opts.subject.length} bodyLength=${opts.body.length}`,
  );
}

export class SmtpProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'EMAIL';
  private readonly logger = new Logger(SmtpProvider.name);

  async send(
    opts: Parameters<NotificationProvider['send']>[0],
  ): Promise<{ delivered: boolean }> {
    logDelivery(this.logger, this.channel, opts);
    return { delivered: true };
  }
}

export class SmsProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'SMS';
  private readonly logger = new Logger(SmsProvider.name);

  async send(
    opts: Parameters<NotificationProvider['send']>[0],
  ): Promise<{ delivered: boolean }> {
    logDelivery(this.logger, this.channel, opts);
    return { delivered: true };
  }
}

export class PushProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'PUSH';
  private readonly logger = new Logger(PushProvider.name);

  async send(
    opts: Parameters<NotificationProvider['send']>[0],
  ): Promise<{ delivered: boolean }> {
    logDelivery(this.logger, this.channel, opts);
    return { delivered: true };
  }
}

export class InAppProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'IN_APP';
  private readonly logger = new Logger(InAppProvider.name);

  async send(
    opts: Parameters<NotificationProvider['send']>[0],
  ): Promise<{ delivered: boolean }> {
    logDelivery(this.logger, this.channel, opts);
    return { delivered: true };
  }
}

export function defaultProviders(): Map<NotificationChannel, NotificationProvider> {
  return new Map<NotificationChannel, NotificationProvider>([
    ['IN_APP', new InAppProvider()],
    ['SMS', new SmsProvider()],
    ['EMAIL', new SmtpProvider()],
    ['PUSH', new PushProvider()],
  ]);
}
