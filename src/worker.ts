import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { OutboxPublisherService } from './database/outbox-publisher.service';

const logger = new Logger('Worker');

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 100;

/**
 * careOS worker: runs BullMQ processors, outbox publishing, and scheduled jobs.
 * Phase 0 only runs the outbox publisher loop against real Postgres + Redis.
 * The app refuses to boot on invalid env (shared config validation).
 */
export async function runWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  const publisher = app.get(OutboxPublisherService);

  logger.log('careOS worker started');
  logger.debug(`outbox poll interval: ${POLL_INTERVAL_MS}ms, batch: ${BATCH_SIZE}`);

  const timer: NodeJS.Timeout = setInterval(async () => {
    try {
      const published = await publisher.publishReadyEvents(BATCH_SIZE);
      if (published > 0) {
        logger.log({ published }, 'outbox events published');
      }
    } catch (err) {
      logger.error(
        err instanceof Error ? err.stack : String(err),
        'outbox publish pass failed',
      );
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn({ signal }, 'worker shutting down');
    clearInterval(timer);
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
