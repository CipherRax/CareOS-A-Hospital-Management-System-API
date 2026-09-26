import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { LedgerPostingConsumer } from './ledger-postings.consumer';

/**
 * Financial ledger (repo Phase 11): chart of accounts, financial periods,
 * manual journals, trial balance, and the outbox ledger-posting consumer.
 * The consumer is contributed to the outbox composition root in OutboxModule.
 */
@Module({
  controllers: [LedgerController],
  providers: [LedgerService, LedgerPostingConsumer],
  exports: [LedgerService, LedgerPostingConsumer],
})
export class LedgerModule {}

export { LedgerPostingConsumer }; // re-export for the outbox composition root