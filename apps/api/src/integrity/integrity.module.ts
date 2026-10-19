import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabasePrivilegesService } from './database-privileges.service.js';
import { INTEGRITY_KEYRING } from './integrity.constants.js';
import { IntegrityController } from './integrity.controller.js';
import { integrityKeyringFromEnv } from './integrity-keys.js';
import { IntegrityJobsService } from './integrity-jobs.service.js';
import { IntegrityStatusService } from './integrity-status.service.js';
import { JobRunsService } from './job-runs.service.js';
import { SealerService } from './sealer.service.js';
import { VerifierService } from './verifier.service.js';

// Sealing, verification and the daily jobs of the audit log (docs/adr/0008),
// and the check that the API's role cannot change it (docs/adr/0007).
@Module({
  imports: [AuthModule],
  controllers: [IntegrityController],
  providers: [
    { provide: INTEGRITY_KEYRING, useFactory: integrityKeyringFromEnv },
    DatabasePrivilegesService,
    IntegrityJobsService,
    IntegrityStatusService,
    JobRunsService,
    SealerService,
    VerifierService,
  ],
  exports: [DatabasePrivilegesService, JobRunsService, SealerService, VerifierService],
})
export class IntegrityModule {}
