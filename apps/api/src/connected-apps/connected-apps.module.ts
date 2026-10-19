import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConnectedAppsController } from './connected-apps.controller.js';
import { ConnectedAppsService } from './connected-apps.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ConnectedAppsController],
  providers: [ConnectedAppsService],
  exports: [ConnectedAppsService],
})
export class ConnectedAppsModule {}
