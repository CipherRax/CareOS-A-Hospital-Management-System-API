import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/config.module';
import {
  DarajaMpesaProvider,
  MockMpesaProvider,
  type MpesaStkProvider,
} from './mpesa.provider';

/**
 * M-PESA integration seam (repo Phase 11). MPESA_PROVIDER selects the adapter:
 * 'mock' in dev/test (no network), 'daraja' for the Safaricom-shaped adapter
 * (honest non-live stub — see docs/limitations.md). The mpesa module depends
 * on the MpesaStkProvider token only.
 */
export const MPESA_STK_PROVIDER = Symbol('MPESA_STK_PROVIDER');

@Module({
  providers: [
    {
      provide: MPESA_STK_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): MpesaStkProvider =>
        env.MPESA_PROVIDER === 'daraja'
          ? new DarajaMpesaProvider({
              baseUrl: env.MPESA_BASE_URL,
              shortcode: env.MPESA_SHORTCODE,
            })
          : new MockMpesaProvider(),
    },
  ],
  exports: [MPESA_STK_PROVIDER],
})
export class MpesaIntegrationModule {}

export type { MpesaStkProvider, MockMpesaProvider, ProviderTransaction } from './mpesa.provider';
export { parseStkCallback, type StkCallbackParsed } from './mpesa.provider';