import { Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [QualityModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}