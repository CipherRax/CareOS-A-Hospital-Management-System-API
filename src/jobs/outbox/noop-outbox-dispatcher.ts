import { Injectable, Logger } from '@nestjs/common';
import type {
  OutboxDispatcher,
  OutboxRow,
} from '../../database/outbox-publisher.service';

/**
 * Phase 0 dispatcher: records that an event was dispatched and consumes nothing.
 * Real consumers (notifications, timeline projection, analytics, BullMQ fan-out)
 * register in later phases. The outbox rows already guarantee delivery semantics;
 * a no-op dispatcher is honest — events are marked PUBLISHED only after the
 * (empty) consumer fan-out acknowledges.
 */
@Injectable()
export class NoopOutboxDispatcher implements OutboxDispatcher {
  private readonly logger = new Logger(NoopOutboxDispatcher.name);

  async dispatch(_row: OutboxRow): Promise<boolean> {
    this.logger.debug(
      { type: _row.type, id: _row.id },
      'outbox event dispatched (no consumers yet)',
    );
    return true;
  }
}
