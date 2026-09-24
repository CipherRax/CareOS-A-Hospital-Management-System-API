import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';

@Module({
  imports: [WorkflowsModule, PrescriptionsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}