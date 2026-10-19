import { Global, Logger, Module } from '@nestjs/common';
import { env } from '../../env/env.js';
import { SecretBox, secretBoxFromConfig } from './secret-box.js';

// One SecretBox for the whole API, from AUDIT_SECRETS_KEY (docs/adr/0006).
@Global()
@Module({
  providers: [
    {
      provide: SecretBox,
      useFactory: (): SecretBox => {
        const { box, fallback } = secretBoxFromConfig({
          secret: env.AUDIT_SECRETS_KEY,
          previous: env.AUDIT_SECRETS_KEY_PREVIOUS,
          fallback: env.JWT_ACCESS_SECRET,
        });
        if (fallback) {
          new Logger('Secrets').warn(
            'AUDIT_SECRETS_KEY is not set: stored secrets use a key derived from JWT_ACCESS_SECRET (development only; required in production).',
          );
        }
        return box;
      },
    },
  ],
  exports: [SecretBox],
})
export class CryptoModule {}
