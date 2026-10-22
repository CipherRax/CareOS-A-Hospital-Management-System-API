import { Injectable, Logger } from '@nestjs/common';
import {
  type OutboxConsumer,
  type OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { EventTypes } from '../../events/catalog';
import { DataExportService } from './data-export.service';

/**
 * `Privacy.DataExportRequested` side-effect.
 *
 * The request records the job and returns; this consumer builds the artifact.
 * A failure is recorded on the row as FAILED with a PHI-free reason rather
 * than re-thrown: re-raising would make the outbox retry an export that cannot
 * succeed (a storage outage would loop), and a row stuck in PENDING with no
 * explanation is the worst outcome for an operator.
 */
@Injectable()
export class DataExportConsumer implements OutboxConsumer {
  readonly name = 'data-export';
  readonly eventTypes: ReadonlyArray<string> = [EventTypes.DataExportRequested];

  private readonly logger = new Logger(DataExportConsumer.name);

  constructor(private readonly exports: DataExportService) {}

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = (ctx.row.payload ?? {}) as { dataExportId?: unknown };
    const exportId =
      typeof payload.dataExportId === 'string' ? payload.dataExportId : ctx.row.aggregateId;
    if (!exportId) {
      this.logger.warn(`data export request ${ctx.row.id} carried no export id; skipped`);
      return;
    }

    await this.exports.build(exportId, ctx.organizationId);
  }
}
