import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConnectedAppsModule } from '../connected-apps/connected-apps.module.js';
import { IntegrityModule } from '../integrity/integrity.module.js';
import { RetentionController } from './retention.controller.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [AuthModule, ConnectedAppsModule, IntegrityModule],
  controllers: [RetentionController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
