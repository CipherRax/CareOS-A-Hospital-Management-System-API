import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env.schema';

export const ENV = Symbol('ENV');
export type { Env };

/**
 * Reads and validates the process environment once at boot.
 * `parseEnv` throws on invalid config — the app refuses to start.
 * Tests override the ENV token with a parsed test environment.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => parseEnv(process.env),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}

export function validateEnv(raw: NodeJS.ProcessEnv): Env {
  return parseEnv(raw);
}
