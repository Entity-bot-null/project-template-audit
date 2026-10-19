import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConnectedAppsModule } from '../connected-apps/connected-apps.module.js';
import { ErasureService } from './erasure.service.js';
import { ExplorerController } from './explorer.controller.js';
import { ExplorerService } from './explorer.service.js';
import { ExportService } from './export.service.js';
import { ExportsController } from './exports.controller.js';

@Module({
  imports: [AuthModule, AccessModule, ConnectedAppsModule],
  controllers: [ExplorerController, ExportsController],
  providers: [ExplorerService, ErasureService, ExportService],
  exports: [ExplorerService, ErasureService],
})
export class ExplorerModule {}
