import { Module } from '@nestjs/common';
import { ClinicalNotesController } from './clinical-notes.controller';
import { ClinicalNotesService } from './clinical-notes.service';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  imports: [WorkflowsModule],
  controllers: [ClinicalNotesController],
  providers: [ClinicalNotesService],
})
export class ClinicalNotesModule {}