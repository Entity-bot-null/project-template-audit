import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { derivedKey } from '../common/crypto/secret-box.js';
import { env } from '../env/env.js';
import { ACCESS_TOKEN_ALGORITHM, ACCESS_TOKEN_TTL_SEC, SIGN_UP_ENABLED } from './auth.constants.js';
import { AccountTokenSweep } from './account-tokens.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccountMfaController, MfaAdminController, MfaController } from './mfa/mfa.controller.js';
import { MfaChallengesService } from './mfa/mfa-challenges.service.js';
import { MFA_PEPPERS } from './mfa/mfa.constants.js';
import { MfaService } from './mfa/mfa.service.js';
import { RecentAuthGuard } from './recent-auth.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionsService } from './sessions.service.js';
import { SignUpService } from './sign-up.service.js';

@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      // Pinned so a verifier can never be talked into another algorithm.
      signOptions: { expiresIn: ACCESS_TOKEN_TTL_SEC, algorithm: ACCESS_TOKEN_ALGORITHM },
      verifyOptions: { algorithms: [ACCESS_TOKEN_ALGORITHM] },
    }),
  ],
  controllers: [AuthController, MfaController, AccountMfaController, MfaAdminController],
  providers: [
    AuthService,
    MfaChallengesService,
    MfaService,
    RecentAuthGuard,
    {
      // Recovery codes' HMAC keys (docs/adr/0012), from AUDIT_SECRETS_KEY:
      // the current one, then the previous one during a rotation.
      provide: MFA_PEPPERS,
      useFactory: () =>
        [env.AUDIT_SECRETS_KEY ?? env.JWT_ACCESS_SECRET, env.AUDIT_SECRETS_KEY_PREVIOUS]
          .filter((secret) => secret !== undefined)
          .map((secret) =>
            derivedKey(
              { secret, previous: undefined, fallback: env.JWT_ACCESS_SECRET },
              'mfa-recovery-codes',
            ),
          ),
    },
    SessionsService,
    PasswordResetService,
    SignUpService,
    AccountTokenSweep,
    { provide: SIGN_UP_ENABLED, useFactory: () => env.SIGN_UP_ENABLED },
  ],
  // @Auth() instantiates JwtAuthGuard in the importing module, so what must
  // be exported is the JwtModule (the one JwtService with the pinned options).
  exports: [JwtModule, SessionsService, AuthService, MfaChallengesService, RecentAuthGuard],
})
export class AuthModule {}
