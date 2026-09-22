import { Module } from '@nestjs/common';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassService } from './break-glass.service';

@Module({
  controllers: [BreakGlassController],
  providers: [BreakGlassService],
})
export class BreakGlassModule {}
