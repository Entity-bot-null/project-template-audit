import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountAppsController } from './account-apps.controller.js';
import { AppAccessService } from './app-access.service.js';
import { UserAccessController } from './user-access.controller.js';
import { UserAccessService } from './user-access.service.js';

// Who may see which application (docs/security.md#authorization), and the
// administration of roles and assignments.
@Module({
  imports: [AuthModule],
  controllers: [UserAccessController, AccountAppsController],
  providers: [AppAccessService, UserAccessService],
  exports: [AppAccessService],
})
export class AccessModule {}
