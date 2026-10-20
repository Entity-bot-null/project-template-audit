import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { EmailChangeController } from './email-change.controller.js';
import { EmailChangeService } from './email-change.service.js';
import {
  NotificationPreferencesController,
  NotificationPreferencesService,
} from './notification-preferences.js';

@Module({
  imports: [AuthModule],
  controllers: [AccountController, EmailChangeController, NotificationPreferencesController],
  providers: [AccountService, EmailChangeService, NotificationPreferencesService],
})
export class AccountModule {}
