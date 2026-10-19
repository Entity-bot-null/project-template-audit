import { BadRequestException, Body, Controller, HttpCode, Post, Put, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CatalogPublish,
  CatalogPublishResultSchema,
  CatalogPublishSchema,
  EventBatchEnvelopeSchema,
  EventBatchResultSchema,
  type Heartbeat,
  HeartbeatResultSchema,
  HeartbeatSchema,
  SIGNATURE_HEADERS,
  SUPPORTED_CONTRACT_VERSIONS,
} from 'audit-contract';
import type { Response } from 'express';
import type { z } from 'zod';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import { AppSignature, SignedApp } from './app-signature.decorator.js';
import { CatalogService } from './catalog.service.js';
import { EventIngestService } from './event-ingest.service.js';
import type { AuthenticatedApp } from './ingest.types.js';
import { SequenceMonitorService } from './sequence-monitor.service.js';

type EventBatchEnvelope = z.infer<typeof EventBatchEnvelopeSchema>;

/** 400 with Audit-Error, so a connector tells an outdated contract from a bad request. */
function checkContractVersion(version: number, res: Response): void {
  if (SUPPORTED_CONTRACT_VERSIONS.includes(version)) return;
  res.setHeader(SIGNATURE_HEADERS.error, 'contract_version_unsupported');
  throw new BadRequestException(
    `contractVersion: ${String(version)} is not supported; supported: ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}`,
  );
}

// The ingestion API (docs/design/audit-hub/contract.md): connected
// applications' APIs, never people. Public in the bearer sense (no @Auth(),
// listed in openapi.spec.ts with its reason) and protected by a signature
// instead (docs/adr/0006).
@ApiTags('ingest')
@Controller('ingest')
@AppSignature()
export class IngestController {
  constructor(
    private readonly events: EventIngestService,
    private readonly catalogs: CatalogService,
    private readonly sequences: SequenceMonitorService,
  ) {}

  @Post('events')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a batch of events',
    description:
      'At most 100 events and 100 kB. Answers one result per event (accepted, duplicate, or rejected with its reason): one bad event never fails the batch. 400 with Audit-Error contract_version_unsupported: update the connector.',
  })
  @ZodBody(EventBatchEnvelopeSchema)
  @ApiData(EventBatchResultSchema)
  @ApiErrors(400, 403, 503)
  ingest(
    @SignedApp() app: AuthenticatedApp,
    @Body() body: EventBatchEnvelope,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkContractVersion(body.contractVersion, res);
    return this.events.ingest(app, body);
  }

  @Put('catalog')
  @ApiOperation({
    summary: "Publish the application's catalog of actions",
    description:
      'Idempotent: the same document answers unchanged. 400: the catalog is invalid, or moves an action to a category kept for less time.',
  })
  @ZodBody(CatalogPublishSchema)
  @ApiData(CatalogPublishResultSchema)
  @ApiErrors(400, 403)
  publish(
    @SignedApp() app: AuthenticatedApp,
    @Body() body: CatalogPublish,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkContractVersion(body.contractVersion, res);
    return this.catalogs.publish(app.appId, app.keyId, body.catalog);
  }

  @Post('heartbeat')
  @HttpCode(200)
  @ApiOperation({
    summary: "A connector instance's heartbeat",
    description:
      'Every minute: its version, its queue, its sequence. Answers what Audit Hub has received.',
  })
  @ZodBody(HeartbeatSchema)
  @ApiData(HeartbeatResultSchema)
  @ApiErrors(400, 403)
  heartbeat(
    @SignedApp() app: AuthenticatedApp,
    @Body() body: Heartbeat,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkContractVersion(body.contractVersion, res);
    return this.sequences.heartbeat(app, body);
  }
}
