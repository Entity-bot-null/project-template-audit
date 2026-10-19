import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ActivityPageSchema,
  ActivityQuerySchema,
  type ErasureRequest,
  ErasureRequestSchema,
  ErasureResultSchema,
  ID_PATTERN,
  SubjectExportPageSchema,
} from 'audit-contract';
import { z } from 'zod';
import { ApiData, ApiErrors, ZodBody, ZodQuery } from '../common/openapi/index.js';
import { ErasureService } from '../explorer/erasure.service.js';
import { AppSignature, SignedApp } from '../ingest/app-signature.decorator.js';
import type { AuthenticatedApp } from '../ingest/ingest.types.js';
import { ConnectorService } from './connector.service.js';

const subjectOf = (value: string) => {
  if (!ID_PATTERN.test(value)) throw new BadRequestException('subject: not an id');
  return value;
};
const ExportQuerySchema = z.object({ cursor: z.string().max(256).optional() });

// What an application asks about one of its users (contract.md, "Query API
// for applications"): signed with its key like ingestion (no @Auth(), listed
// in openapi.spec.ts as a machine route), its own data only.
@ApiTags('connector')
@Controller('connector/subjects/:subject')
@AppSignature()
export class ConnectorController {
  constructor(
    private readonly connector: ConnectorService,
    private readonly erasure: ErasureService,
  ) {}

  @Get('activity')
  @ApiOperation({
    summary: 'The user\'s own security activity ("My account\'s security")',
    description:
      'The actions the catalog marks user-visible, newest first, with minimal fields and no IP. The application shows them only to that user.',
  })
  @ZodQuery(ActivityQuerySchema)
  @ApiData(ActivityPageSchema)
  @ApiErrors(400, 403)
  activity(
    @SignedApp() app: AuthenticatedApp,
    @Param('subject') subject: string,
    @Query() query: z.infer<typeof ActivityQuerySchema>,
  ) {
    return this.connector.activity(app, subjectOf(subject), query);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Right of access: every event of the user, with what is still kept of it',
    description: '100 events a page, newest first; pass nextCursor back as cursor.',
  })
  @ZodQuery(ExportQuerySchema)
  @ApiData(SubjectExportPageSchema)
  @ApiErrors(400, 403)
  export(
    @SignedApp() app: AuthenticatedApp,
    @Param('subject') subject: string,
    @Query() query: z.infer<typeof ExportQuerySchema>,
  ) {
    return this.connector.export(app, subjectOf(subject), query.cursor);
  }

  @Post('erasure')
  @HttpCode(200)
  @ApiOperation({
    summary: "Right to erasure: delete the user's personal data in Audit Hub, or their events too",
    description:
      'Scope personal (the default, and what an account deletion event does): the satellite rows of every event of the user, except what a legal hold keeps; the events stay, pseudonymous, and the user is blocked in the per-person views. Scope events, once the controller cancels them: the events go too, the sealed ones at once and the rest within a day (docs/security.md).',
  })
  @ZodBody(ErasureRequestSchema, { optional: true })
  @ApiData(ErasureResultSchema)
  @ApiErrors(400, 403)
  erase(
    @SignedApp() app: AuthenticatedApp,
    @Param('subject') subject: string,
    @Body() body: ErasureRequest,
  ) {
    return this.erasure.erase(
      app.appId,
      subjectOf(subject),
      'connector',
      { actor: { type: 'service', id: app.slug } },
      body.scope,
    );
  }
}
