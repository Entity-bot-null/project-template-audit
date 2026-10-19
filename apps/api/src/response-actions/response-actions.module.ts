import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { ResponseActionsController } from './response-actions.controller.js';
import { ResponseActionsService } from './response-actions.service.js';

@Module({
  imports: [AuthModule, WebhooksModule],
  controllers: [ResponseActionsController],
  providers: [ResponseActionsService],
  exports: [ResponseActionsService],
})
export class ResponseActionsModule {}
