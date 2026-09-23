import { Module } from '@nestjs/common';
import { VitalsController } from './vitals.controller';
import { VitalsService } from './vitals.service';

@Module({
  controllers: [VitalsController],
  providers: [VitalsService],
})
export class VitalsModule {}