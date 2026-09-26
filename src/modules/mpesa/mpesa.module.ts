import { Global, Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { MpesaIntegrationModule } from '../../integrations/mpesa/mpesa-integration.module';
import { MpesaController } from './mpesa.controller';
import { MpesaService } from './mpesa.service';

/**
 * M-PESA STK push + reconciliation (repo Phase 11).
 *
 * Imports WorkflowsModule for invoice lifecycle enforcement and the
 * M-PESA integration module for the MPESA_STK_PROVIDER token.
 */
@Global()
@Module({
  imports: [WorkflowsModule, MpesaIntegrationModule],
  controllers: [MpesaController],
  providers: [MpesaService],
  exports: [MpesaService],
})
export class MpesaModule {}

export { MpesaService };