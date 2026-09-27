import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

const logger = new Logger('Worker');

/**
 * careOS worker: boots the application context so every BullMQ processor and
 * the time-based scheduler (ADR-044 — outbox drain, maintenance reminders,
 * idempotency reclamation, export expiry) runs. The app refuses to boot on
 * invalid env (shared config validation).
 *
 * There is no polling loop here any more: P5 moved the outbox drain off a bare
 * `setInterval` onto a repeatable BullMQ job, so a process that is not running
 * the worker simply does not deliver events instead of silently doing so in
 * whichever process happened to boot.
 */
export async function runWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  logger.log('careOS worker started (BullMQ processors + scheduler duties)');

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn({ signal }, 'worker shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void runWorker().catch((err: unknown) => {
  logger.error(
    'careOS worker failed to start',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
