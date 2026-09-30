import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService],
  // The eligibility predicate is a pure function, not a provider, so nothing is
  // re-exported for other modules: they import it directly from
  // `domain/provider-eligibility`, which is what keeps one definition of
  // "bookable" rather than one per call site.
  exports: [],
})
export class ProvidersModule {}
