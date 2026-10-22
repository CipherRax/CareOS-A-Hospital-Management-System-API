import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { OUTBOX_CONSUMERS, type OutboxConsumer } from '../../events/outbox-consumer/outbox-consumer.types';
import { ConsumerOutboxDispatcher } from '../../events/outbox-consumer/consumer-outbox-dispatcher';
import { OUTBOX_DISPATCHER } from '../../database/outbox.tokens';
import { OutboxPublisherService } from '../../database/outbox-publisher.service';
import { TimelineProjectionConsumer } from '../../events/consumers/timeline.consumer';
import { PharmacyTaskConsumer } from '../../events/consumers/pharmacy-tasks.consumer';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationConsumer } from '../notifications/notifications.consumer';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerPostingConsumer } from '../ledger/ledger-postings.consumer';
import { InsightsModule } from '../insights/insights.module';
import { ReportExportConsumer } from '../insights/report-export.consumer';
import { RollupTouchConsumer } from '../insights/rollups.consumer';
import { DirectoryModule } from '../directory/directory.module';
import { PublicListingConsumer } from '../directory/directory.consumer';
import { CodingModule } from '../coding/coding.module';
import { CodingReferenceConsumer } from '../coding/coding.consumer';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentScanConsumer } from '../documents/document-scan.consumer';
import { EmergencyIntakeModule } from '../emergency-intake/emergency-intake.module';
import { EmergencyNotificationConsumer } from '../emergency-intake/emergency-notifications.consumer';
import { ChangeLogProjectionConsumer } from '../../events/consumers/change-log.consumer';
import { PrivacyModule } from '../privacy/privacy.module';
import { DataExportConsumer } from '../privacy/data-export.consumer';

/**
 * Composition root for the transactional outbox.
 *
 * The consumer bus lives here (a modules-layer module) so it can pull
 * consumers from every feature module without the database layer importing
 * them: DatabaseModule provides the core projection consumers and
 * NotificationsModule contributes the staff-notification projection. Keeping
 * layer rules intact, all consumer instances are assembled in ONE
 * OUTBOX_CONSUMERS value (no multi-provider merging across global scopes).
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    LedgerModule,
    InsightsModule,
    DirectoryModule,
    CodingModule,
    DocumentsModule,
    EmergencyIntakeModule,
    PrivacyModule,
  ],
  providers: [
    ChangeLogProjectionConsumer,
    DataExportConsumer,
    {
      provide: OUTBOX_CONSUMERS,
      useFactory: (
        timeline: TimelineProjectionConsumer,
        pharmacyTasks: PharmacyTaskConsumer,
        notifications: NotificationConsumer,
        ledger: LedgerPostingConsumer,
        rollups: RollupTouchConsumer,
        publicListing: PublicListingConsumer,
        coding: CodingReferenceConsumer,
        documentScan: DocumentScanConsumer,
        reportExport: ReportExportConsumer,
        emergency: EmergencyNotificationConsumer,
        changeLog: ChangeLogProjectionConsumer,
        dataExport: DataExportConsumer,
      ): OutboxConsumer[] => [
        timeline,
        pharmacyTasks,
        notifications,
        ledger,
        rollups,
        publicListing,
        coding,
        documentScan,
        reportExport,
        emergency,
        changeLog,
        dataExport,
      ],
      inject: [
        TimelineProjectionConsumer,
        PharmacyTaskConsumer,
        NotificationConsumer,
        LedgerPostingConsumer,
        RollupTouchConsumer,
        PublicListingConsumer,
        CodingReferenceConsumer,
        DocumentScanConsumer,
        ReportExportConsumer,
        EmergencyNotificationConsumer,
        ChangeLogProjectionConsumer,
        DataExportConsumer,
      ],
    },
    ConsumerOutboxDispatcher,
    { provide: OUTBOX_DISPATCHER, useExisting: ConsumerOutboxDispatcher },
    OutboxPublisherService,
  ],
  exports: [OutboxPublisherService, OUTBOX_DISPATCHER],
})
export class OutboxModule {}