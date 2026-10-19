import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../auth/auth.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { AppAccessService } from './app-access.service.js';
import { VisibleAppsSchema } from './dto/access.schemas.js';

// The applications the signed-in person may see, for the admin pages'
// pickers and navigation. The list of every application with its settings
// stays with administrators (GET /api/connected-apps).
@ApiTags('account')
@Controller('account')
@Auth()
export class AccountAppsController {
  constructor(private readonly access: AppAccessService) {}

  @Get('apps')
  @ApiOperation({
    summary: 'The applications the caller may see',
    description:
      "Administrators: every one, Audit Hub's own last; auditors and viewers: the ones assigned to them; members: none.",
  })
  @ApiData(VisibleAppsSchema)
  @ApiErrors(401)
  apps(@CurrentUser() user: RequestUser) {
    return this.access.listVisible(user);
  }
}
