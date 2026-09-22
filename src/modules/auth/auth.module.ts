import { Module } from '@nestjs/common';
import { FieldEncryption } from '../../common/security/crypto';
import { ENV, type Env } from '../../config/config.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BruteForceService } from './brute-force.service';
import { SessionService } from './sessions.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    AccessTokenService,
    BruteForceService,
    {
      provide: FieldEncryption,
      useFactory: (env: Env) => new FieldEncryption(env.KEY_ENCRYPTION_SECRET),
      inject: [ENV],
    },
  ],
  exports: [AuthService, SessionService, AccessTokenService, FieldEncryption],
})
export class AuthModule {}
