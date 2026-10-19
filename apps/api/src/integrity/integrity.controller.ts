import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../auth/auth.decorator.js';
import { ApiData, ApiErrors } from '../common/openapi/index.js';
import { IntegrityStatusSchema } from './dto/integrity.schemas.js';
import { IntegrityStatusService } from './integrity-status.service.js';

// Integrity at a glance, administrators only: the CLI (pnpm --filter api
// audit status|verify|export) does the same from a terminal.
@ApiTags('integrity')
@Controller('integrity')
@Auth('admin')
export class IntegrityController {
  constructor(private readonly status: IntegrityStatusService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Sealing and verification state of every stream',
    description:
      'Per application and category: the last seal, the events waiting for one, and the latest verifications.',
  })
  @ApiData(IntegrityStatusSchema)
  @ApiErrors(403)
  get() {
    return this.status.status();
  }
}
