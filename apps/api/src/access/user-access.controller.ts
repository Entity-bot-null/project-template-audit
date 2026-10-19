import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Auth } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import {
  type AssignAppsDto,
  AssignAppsSchema,
  type ChangeRoleDto,
  ChangeRoleSchema,
  type ChangeStatusDto,
  ChangeStatusSchema,
  UserAccessSchema,
} from './dto/access.schemas.js';
import { UserAccessService } from './user-access.service.js';

// Audit Hub's people, administrators only: roles, the applications each
// auditor or viewer may see, whether an account may sign in, and removing
// one. Changes need a recent step-up and are recorded (docs/adr/0012).
@ApiTags('users')
@Controller('users/:id')
@Auth('admin')
export class UserAccessController {
  constructor(
    private readonly access: UserAccessService,
    private readonly hubAudit: HubAuditService,
  ) {}

  @Get('access')
  @ApiOperation({ summary: "A person's role, second factor and applications" })
  @ApiData(UserAccessSchema)
  @ApiErrors(400, 403, 404)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.access.get(id);
  }

  @Patch('role')
  @RequireRecentAuth()
  @ApiOperation({
    summary: "Change a person's role",
    description:
      'Their access tokens stop at once; the next refresh brings the new role. 409: the last administrator cannot be demoted.',
  })
  @ZodBody(ChangeRoleSchema)
  @ApiData(UserAccessSchema)
  @ApiErrors(400, 403, 404, 409)
  async changeRole(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeRoleDto,
    @Req() req: Request,
  ) {
    const previous = await this.access.changeRole(admin.id, id, body.role);
    await this.hubAudit.recordQuietly({
      action: 'hub.user.role_changed',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'user', id },
      change: { before: { role: previous }, after: { role: body.role } },
      request: req,
    });
    return this.access.get(id);
  }

  @Patch('status')
  @RequireRecentAuth()
  @ApiOperation({
    summary: "Disable a person's account, or enable it again",
    description:
      'Disabling ends every session and access token at once; sign-in answers as for a wrong password until the account is enabled. 409: your own account, the last administrator who may sign in, or a removed account.',
  })
  @ZodBody(ChangeStatusSchema)
  @ApiData(UserAccessSchema)
  @ApiErrors(400, 403, 404, 409)
  async changeStatus(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeStatusDto,
    @Req() req: Request,
  ) {
    if (await this.access.setDisabled(admin.id, id, body.disabled)) {
      await this.hubAudit.recordQuietly({
        action: body.disabled ? 'hub.user.disabled' : 'hub.user.enabled',
        actor: { type: 'user', id: admin.id, role: admin.role },
        resource: { type: 'user', id },
        request: req,
      });
    }
    return this.access.get(id);
  }

  @Delete()
  @HttpCode(204)
  @RequireRecentAuth()
  @ApiOperation({
    summary: 'Remove a person from Audit Hub',
    description:
      'Their account keeps its id, so the records that name it still resolve, but nothing of them: address, name, password, second factor, sessions and assignments go, and it stays disabled for good. Open alerts assigned to them are assigned to nobody. 409: your own account, the last administrator who may sign in, or an account already removed.',
  })
  @ApiResponse({ status: 204, description: 'Removed' })
  @ApiErrors(400, 403, 404, 409)
  async remove(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    const removal = await this.access.remove(admin.id, id);
    await this.hubAudit.recordQuietly({
      action: 'hub.user.removed',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'user', id },
      details: { alertsUnassigned: removal.alertsUnassigned },
      request: req,
    });
  }

  @Put('apps')
  @RequireRecentAuth()
  @ApiOperation({
    summary: 'Set the applications an auditor or a viewer may see',
    description:
      'The whole list: assignments not in it end. 404: an application that does not exist.',
  })
  @ZodBody(AssignAppsSchema)
  @ApiData(UserAccessSchema)
  @ApiErrors(400, 403, 404)
  async assignApps(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignAppsDto,
    @Req() req: Request,
  ) {
    const access = await this.access.assignApps(admin.id, id, body.appIds);
    await this.hubAudit.recordQuietly({
      action: 'hub.user.apps_assigned',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'user', id },
      details: { apps: access.apps.map((app) => app.appId) },
      request: req,
    });
    return access;
  }
}
