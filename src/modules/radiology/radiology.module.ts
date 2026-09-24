import { Module } from '@nestjs/common';
import { RadiologyController } from './radiology.controller';
import { RadiologyService } from './radiology.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ImagingModule } from '../../integrations/imaging/imaging.module';

@Module({
  imports: [WorkflowsModule, ImagingModule],
  controllers: [RadiologyController],
  providers: [RadiologyService],
})
export class RadiologyModule {}