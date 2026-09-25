import { Module } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { InpatientModule } from '../inpatient/inpatient.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  imports: [InpatientModule, WorkflowsModule],
  controllers: [EmergencyController],
  providers: [EmergencyService],
})
export class EmergencyModule {}